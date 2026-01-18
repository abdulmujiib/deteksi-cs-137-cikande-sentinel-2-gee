// ===============================================================================
// DETEKSI STRES VEGETASI & Cs-137 (SENTINEL-2) - HANYA DI DALAM POLIGON
// Poligon: Area Khusus (4 titik + penutup)
// ===============================================================================

// === 1. DEFINISI POLIGON TETAP ===
var polygonCoords = [
  [106.315158, -6.148370],
  [106.392577, -6.147687],
  [106.388285, -6.234724],
  [106.295760, -6.221584],
  [106.315158, -6.148370]  // Penutup
];

var studyArea = ee.Geometry.Polygon([polygonCoords], null, false);

// Tambahkan poligon ke peta (garis merah tebal)
Map.addLayer(studyArea, {color: 'red', fillColor: '00000000', width: 3}, 'Area Studi (Poligon Tetap)', true);
Map.centerObject(studyArea, 13);

// === 2. UI PANEL KONTROL ===
var panel = ui.Panel({
  style: {width: '380px', position: 'top-left', padding: '10px', backgroundColor: '#f8f9fa'}
});
Map.add(panel);

var title = ui.Label('Deteksi Stres Vegetasi & Cs-137 (Sentinel-2)', {
  fontWeight: 'bold', fontSize: '18px', margin: '0 0 10px 0'
});
panel.add(title);

// Slider Tanggal
var dateSlider = ui.DateSlider({
  start: '2014-01-01',
  end: '2025-09-30',
  value: ['2014-01-01', '2025-09-30'],
  period: 30,  // Set period to 30 days (approximating a month)
  onChange: updateMap
});
panel.add(ui.Label('Rentang Tanggal:'));
panel.add(dateSlider);

// Tombol
var refreshBtn = ui.Button('Refresh Peta', updateMap, null, {stretch: 'horizontal'});
var exportBtn = ui.Button({
  label: 'Ekspor Peta Stres (GeoTIFF)',
  onClick: function() {
    Export.image.toDrive({
      image: stressClass.clip(studyArea),
      description: 'Sentinel2_Stres_Cs137_Poligon_' + new Date().toISOString().split('T')[0],
      scale: 10,
      region: studyArea,
      maxPixels: 1e10
    });
  },
  style: {stretch: 'horizontal'}
});
panel.add(ui.Panel([refreshBtn, exportBtn], ui.Panel.Layout.Flow('horizontal')));

// Variabel global
var s2Image, ndvi, redEdge, swir, ndviChange, cs137Proxy, stressClass;

// === 3. FUNGSI UTAMA (HANYA DI DALAM POLIGON) ===
function updateMap() {
  Map.layers().reset();
  Map.addLayer(studyArea, {color: 'red', fillColor: '00000000', width: 3}, 'Area Studi (Poligon Tetap)', true);

  var dateRange = dateSlider.getValue();
  var start = ee.Date(dateRange[0]);
  var end = ee.Date(dateRange[1]);

  // === SENTINEL-2 COLLECTION (HANYA DI POLIGON) ===
  var collection = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate(start, end)
    .filterBounds(studyArea)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 15))
    .map(maskS2clouds);

  if (collection.size().getInfo() === 0) {
    print('Tidak ada data Sentinel-2 di poligon pada rentang tanggal ini.');
    return;
  }

  s2Image = collection.median().clip(studyArea);  // Clip ke poligon

  // === 4. HITUNG INDIKATOR (HANYA DI POLIGON) ===
  ndvi = s2Image.normalizedDifference(['B8', 'B4']).rename('NDVI');
  redEdge = s2Image.expression(
    '705 + 35 * ((b5 + b6)/2 - b5) / (b6 - b5)', {
      'b5': s2Image.select('B5'),
      'b6': s2Image.select('B6')
    }).rename('RedEdge');
  swir = s2Image.select('B11').rename('SWIR');

  // Baseline NDVI (pra-2021, hanya di poligon)
  var baseline = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterDate('2014-01-01', '2019-12-31')
    .filterBounds(studyArea)
    .filter(ee.Filter.lt('CLOUDY_PIXEL_PERCENTAGE', 10))
    .map(maskS2clouds)
    .mean()
    .clip(studyArea);
  var baselineNdvi = baseline.normalizedDifference(['B8', 'B4']);
  ndviChange = ndvi.subtract(baselineNdvi).divide(baselineNdvi).rename('NDVI_Change');

  // === 5. PROXY Cs-137 ===
  cs137Proxy = ndvi.multiply(-1.5)
    .add(swir.multiply(2.0))
    .add(redEdge.subtract(700).multiply(-0.5))
    .rename('Cs137_Proxy');
  var cs137Detected = cs137Proxy.gt(0.7).rename('Cs137_Detected');

  // === 6. KLASIFIKASI STRES ===
  var stressScore = ndvi.multiply(0.3)
    .add(redEdge.subtract(690).divide(50).min(1).multiply(0.3))
    .add(swir.multiply(-1).add(0.3).max(0).multiply(0.2))
    .add(ndviChange.lt(-0.15).multiply(0.2));

  stressClass = stressScore
    .where(stressScore.gt(0.7), 0)
    .where(stressScore.gte(0.5), 1)
    .where(stressScore.gte(0.3), 2)
    .where(stressScore.lt(0.3), 3)
    .rename('StressLevel');

  // === 7. VISUALISASI (HANYA DI POLIGON) ===
Map.addLayer(s2Image, {bands: ['B4', 'B3', 'B2'], min: 0, max: 0.3}, 'Sentinel-2 RGB (Poligon)', false);
Map.addLayer(ndvi.clip(studyArea), {min: -0.2, max: 0.9, palette: ['blue', 'white', 'yellow', 'green']}, 'NDVI', false);
Map.addLayer(stressClass.clip(studyArea), {
  min: 0, max: 3,
  palette: ['#00ff00', '#ffff00', '#ff9900', '#ff0000']
}, 'Klasifikasi Stres Vegetasi', true);
Map.addLayer(cs137Detected.clip(studyArea).updateMask(cs137Detected), {
  palette: ['#800080']
}, 'Deteksi Cs-137 (Ungu)', true);

  addLegend();
}

// === 8. LEGENDA ===
function addLegend() {
  var legend = ui.Panel({style: {position: 'bottom-right', padding: '8px'}});
  legend.add(ui.Label('Legenda', {fontWeight: 'bold'}));
  var items = [
    {color: '#00ff00', label: 'Sehat'},
    {color: '#ffff00', label: 'Stres Ringan'},
    {color: '#ff9900', label: 'Stres Sedang'},
    {color: '#ff0000', label: 'Stres Berat'},
    {color: '#800080', label: 'Cs-137 Terdeteksi'}
  ];
  items.forEach(function(item) {
    legend.add(ui.Panel([
      ui.Label('', {backgroundColor: item.color, width: '20px', height: '20px'}),
      ui.Label(item.label)
    ], ui.Panel.Layout.Flow('horizontal')));
  });
  Map.add(legend);
}

// === 9. KLIK DI DALAM POLIGON UNTUK GRAFIK ===
// Map.onClick
Map.style().set('cursor', 'crosshair');
Map.onClick(function(coords) {
  var point = ee.Geometry.Point(coords.lon, coords.lat);
  var inside = studyArea.contains(point);
  
  if (inside.getInfo() === false) {
    print('Klik di dalam poligon untuk analisis spektral!');
    return;
  }

  var sample = s2Image.addBands([ndvi, redEdge, swir, ndviChange, cs137Proxy, stressClass])
    .sample({region: point, scale: 10, dropNulls: false})
    .first();

  print('Sampled Feature:', sample); // Debug output
  //print(chartSpectral(point));
  print('=== ANALISIS DI POLIGON ===');
  print('NDVI:', sample.get('NDVI'));
  print('Red Edge (nm):', sample.get('RedEdge'));
  print('SWIR:', sample.get('SWIR'));
  print('Perubahan NDVI (%):', sample.get('NDVI_Change'));
  print('Proxy Cs-137:', sample.get('Cs137_Proxy'));
  print('Cs-137 Terdeteksi:', sample.get('Cs137_Detected') ? 'YA' : 'Tidak');
  print('Tingkat Stres:', ['Sehat', 'Ringan', 'Sedang', 'Berat'][ee.Number(sample.get('StressLevel')).getInfo()]);
});

// chartSpectral
function chartSpectral(point) {
  var bands = ['B1', 'B2', 'B3', 'B4', 'B5', 'B6', 'B7', 'B8', 'B8A', 'B9', 'B11', 'B12', 'AOT'];
  var wavelengths = [0.443, 0.490, 0.560, 0.665, 0.705, 0.740, 0.783, 0.842, 0.865, 0.945, 1.375, 1.610, 2.190, 0.550];
  
  var values = s2Image.select(bands).divide(10000).reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: point,
    scale: 10
  });
  
  return ui.Chart.feature.byFeature(ee.Feature(null, values), bands)
    .setChartType('LineChart')
    .setOptions({
      title: 'Kurva Spektral Sentinel-2 (Di Dalam Poligon)',
      hAxis: {title: 'Panjang Gelombang (µm)', ticks: wavelengths},
      vAxis: {title: 'Reflectance', viewWindow: {min: 0, max: 0.6}},
      lineWidth: 3,
      pointSize: 5,
      colors: ['#1f77b4'],
      series: {0: {areaOpacity: 0.2}}
    });
}

// === 10. MASKING CLOUD ===
function maskS2clouds(image) {
  var qa = image.select('QA60');
  var cloudBitMask = 1 << 10;
  var cirrusBitMask = 1 << 11;
  var mask = qa.bitwiseAnd(cloudBitMask).eq(0)
      .and(qa.bitwiseAnd(cirrusBitMask).eq(0));
  return image.updateMask(mask).divide(10000);
}

// === 11. JALANKAN PERTAMA KALI ===
updateMap();
