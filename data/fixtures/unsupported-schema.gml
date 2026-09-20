<?xml version="1.0" encoding="UTF-8"?>
<!-- Synthetic negative fixture with an intentionally unsupported feature schema. -->
<wfs:FeatureCollection
  xmlns:wfs="http://www.opengis.net/wfs/2.0"
  xmlns:gml="http://www.opengis.net/gml/3.2"
  xmlns:other="https://example.test/unsupported">
  <wfs:member>
    <other:UnsupportedFeature gml:id="unsupported.1">
      <other:geometry>
        <gml:Point srsName="EPSG:3857">
          <gml:pos>2339108 6894699</gml:pos>
        </gml:Point>
      </other:geometry>
    </other:UnsupportedFeature>
  </wfs:member>
</wfs:FeatureCollection>
