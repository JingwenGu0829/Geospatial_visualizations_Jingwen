import mapboxgl from "https://cdn.jsdelivr.net/npm/mapbox-gl@2.15.0/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";

const MAPBOX_ACCESS_TOKEN = window.MAPBOX_ACCESS_TOKEN ?? "";

const STATIONS_URL =
  "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";
const TRAFFIC_URL =
  "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";
const BOSTON_BIKE_LANES_URL =
  "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson";
const CAMBRIDGE_BIKE_LANES_URL =
  "https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson";

const ALL_TIMES = -1;
const MINUTES_PER_DAY = 24 * 60;
const FILTER_RADIUS_MINUTES = 60;

const departureBuckets = Array.from({ length: MINUTES_PER_DAY }, () => []);
const arrivalBuckets = Array.from({ length: MINUTES_PER_DAY }, () => []);
const trafficCache = new Map();

const status = document.querySelector(".map-status");

function setStatus(message) {
  status.textContent = message;
  status.hidden = !message;
}

let map;

if (!MAPBOX_ACCESS_TOKEN) {
  setStatus("Missing Mapbox token. Add a config.js file from config.example.js.");
  throw new Error("Missing Mapbox access token");
}

mapboxgl.accessToken = MAPBOX_ACCESS_TOKEN;

try {
  map = new mapboxgl.Map({
    container: "map",
    style: "mapbox://styles/mapbox/streets-v12",
    center: [-71.09415, 42.36027],
    zoom: 12,
    minZoom: 5,
    maxZoom: 18,
  });
} catch (error) {
  console.error("Could not initialize Mapbox:", error);
  setStatus("Could not initialize Mapbox. Check browser WebGL support.");
  throw error;
}

function formatTime(minutes) {
  const date = new Date(2000, 0, 1, 0, minutes);
  return date.toLocaleString("en-US", { timeStyle: "short" });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

function addBikeLaneLayer(sourceId, layerId, dataUrl) {
  const bikeLanePaint = {
    "line-color": "#24b35c",
    "line-width": ["interpolate", ["linear"], ["zoom"], 10, 1.5, 14, 4.5],
    "line-opacity": 0.58,
  };

  map.addSource(sourceId, {
    type: "geojson",
    data: dataUrl,
  });

  map.addLayer({
    id: layerId,
    type: "line",
    source: sourceId,
    paint: bikeLanePaint,
  });
}

function getCoords(station) {
  const point = new mapboxgl.LngLat(Number(station.lon), Number(station.lat));
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function tripsNearMinute(buckets, minute) {
  if (minute === ALL_TIMES) {
    return buckets.flat();
  }

  const trips = [];
  for (
    let offset = -FILTER_RADIUS_MINUTES;
    offset <= FILTER_RADIUS_MINUTES;
    offset += 1
  ) {
    const index = (minute + offset + MINUTES_PER_DAY) % MINUTES_PER_DAY;
    trips.push(...buckets[index]);
  }
  return trips;
}

function computeStationTraffic(stations, timeFilter = ALL_TIMES) {
  if (trafficCache.has(timeFilter)) {
    return trafficCache.get(timeFilter);
  }

  const departures = d3.rollup(
    tripsNearMinute(departureBuckets, timeFilter),
    (trips) => trips.length,
    (trip) => trip.start_station_id,
  );

  const arrivals = d3.rollup(
    tripsNearMinute(arrivalBuckets, timeFilter),
    (trips) => trips.length,
    (trip) => trip.end_station_id,
  );

  const enrichedStations = stations.map((station) => {
    const id = station.short_name;
    const stationDepartures = departures.get(id) ?? 0;
    const stationArrivals = arrivals.get(id) ?? 0;

    return {
      ...station,
      arrivals: stationArrivals,
      departures: stationDepartures,
      totalTraffic: stationArrivals + stationDepartures,
    };
  });

  trafficCache.set(timeFilter, enrichedStations);
  return enrichedStations;
}

function tooltipText(station) {
  return `${station.name}
${station.totalTraffic} trips
${station.departures} departures
${station.arrivals} arrivals`;
}

function stationDepartureRatio(station, stationFlow) {
  if (!station.totalTraffic) {
    return 0.5;
  }

  return stationFlow(station.departures / station.totalTraffic);
}

map.on("load", async () => {
  try {
    addBikeLaneLayer("boston-bike-lanes", "boston-bike-lanes-layer", BOSTON_BIKE_LANES_URL);
    addBikeLaneLayer(
      "cambridge-bike-lanes",
      "cambridge-bike-lanes-layer",
      CAMBRIDGE_BIKE_LANES_URL,
    );

    setStatus("Loading Bluebikes data...");

    const [stationData, trips] = await Promise.all([
      d3.json(STATIONS_URL),
      d3.csv(TRAFFIC_URL, (trip) => {
        const startedAt = new Date(trip.started_at);
        const endedAt = new Date(trip.ended_at);

        return {
          ...trip,
          started_at: startedAt,
          ended_at: endedAt,
        };
      }),
    ]);

    trips.forEach((trip) => {
      departureBuckets[minutesSinceMidnight(trip.started_at)].push(trip);
      arrivalBuckets[minutesSinceMidnight(trip.ended_at)].push(trip);
    });

    const baseStations = stationData.data.stations;
    const stations = computeStationTraffic(baseStations);
    const radiusScale = d3
      .scaleSqrt()
      .domain([0, d3.max(stations, (station) => station.totalTraffic)])
      .range([0, 25]);
    const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);
    const svg = d3.select(".map-overlay");

    let circles = svg.selectAll("circle.station");

    function updatePositions() {
      circles
        .attr("cx", (station) => getCoords(station).cx)
        .attr("cy", (station) => getCoords(station).cy);
    }

    function updateScatterPlot(timeFilter) {
      const filteredStations = computeStationTraffic(baseStations, timeFilter);

      if (timeFilter === ALL_TIMES) {
        radiusScale.range([0, 25]);
      } else {
        radiusScale.range([3, 50]);
      }

      circles = svg
        .selectAll("circle.station")
        .data(filteredStations, (station) => station.short_name)
        .join(
          (enter) =>
            enter.append("circle").attr("class", "station").call((selection) =>
              selection.append("title"),
            ),
          (update) => update,
          (exit) => exit.remove(),
        )
        .attr("r", (station) => radiusScale(station.totalTraffic))
        .style("--departure-ratio", (station) =>
          stationDepartureRatio(station, stationFlow),
        )
        .each(function updateTitle(station) {
          d3.select(this).select("title").text(tooltipText(station));
        });

      updatePositions();
    }

    const timeSlider = document.getElementById("time-slider");
    const selectedTime = document.getElementById("selected-time");
    const anyTimeLabel = document.getElementById("any-time");

    function updateTimeDisplay() {
      const timeFilter = Number(timeSlider.value);

      if (timeFilter === ALL_TIMES) {
        selectedTime.textContent = "";
        anyTimeLabel.style.display = "block";
      } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = "none";
      }

      updateScatterPlot(timeFilter);
    }

    timeSlider.addEventListener("input", updateTimeDisplay);
    map.on("move", updatePositions);
    map.on("zoom", updatePositions);
    map.on("resize", updatePositions);
    map.on("moveend", updatePositions);

    updateTimeDisplay();
    setStatus("");
  } catch (error) {
    console.error("Could not initialize the map visualization:", error);
    setStatus("Could not load map data. Check the console for details.");
  }
});
