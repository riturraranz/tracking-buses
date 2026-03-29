const express = require("express");
const cors = require("cors");
const GtfsRealtimeBindings = require("gtfs-realtime-bindings");

const app = express();
app.use(cors());
app.use(express.static("public"));

const fs = require("fs");
const csv = require("csv-parser");

let stops = [];
let trips = {};
let routes = {};
let stopTimes = {};
let routeStops = [];

// Leer route_stops.csv
function cargarRouteStops() {
  return new Promise((resolve) => {
    const path = require("path");
    fs.createReadStream(path.join(__dirname, "GTFS", "route_stop.csv"))
      .pipe(csv())
      .on("data", (row) => {
        routeStops.push(row);
      })
      .on("end", resolve);
  });
}

// Leer routes.txt
function cargarRoutes() {
  return new Promise((resolve) => {
    const path = require("path");
    fs.createReadStream(path.join(__dirname, "GTFS", "routes.txt"))
      .pipe(csv())
      .on("data", (row) => {
        routes[row.route_id] = row.agency_id;
      })
      .on("end", resolve);
  });
}

// Leer trips.txt
function cargarTrips() {
  return new Promise((resolve) => {
    const path = require("path");
    fs.createReadStream(path.join(__dirname, "GTFS", "trips.txt"))
      .pipe(csv())
      .on("data", (row) => {
        trips[row.trip_id] = row.route_id;
      })
      .on("end", resolve);
  });
}

// Leer stops.txt
function cargarStops() {
  return new Promise((resolve) => {
    const path = require("path");
    fs.createReadStream(path.join(__dirname, "GTFS", "stops.txt"))
      .pipe(csv())
      .on("data", (row) => {
        stops.push(row);
      })
      .on("end", resolve);
  });
}

// Leer stop_times.txt
function cargarStopTimes() {
  return new Promise((resolve) => {
    const path = require("path");
    fs.createReadStream(path.join(__dirname, "GTFS", "stop_times.txt"))
      .pipe(csv())
      .on("data", (row) => {
        if (!stopTimes[row.trip_id]) {
          stopTimes[row.trip_id] = [];
        }
        stopTimes[row.trip_id].push(row.stop_id);
      })
      .on("end", resolve);
  });
}

app.get("/buses", async (req, res) => {
  try {
    const url = "https://vdvlima.utryt.com.co:9015/interfaces/gtfsrt/vehicle_positions";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const response = await fetch(url, { signal: controller.signal });

    clearTimeout(timeout);

    const buffer = await response.arrayBuffer();

    console.log("Content-Type:", response.headers.get("content-type"));
    console.log("Status:", response.status);
    const feed = GtfsRealtimeBindings.transit_realtime.FeedMessage.decode(
      new Uint8Array(buffer)
    );

    const buses = [];

    feed.entity.forEach(entity => {
      if (!entity.vehicle) return;

      const v = entity.vehicle;

      if (!v.position || !v.trip) return;

      const route_id = v.trip.routeId || "";
      const agency = route_id.split("_")[0];

      if (!["4", "5", "11"].includes(agency)) return;

      buses.push({
        id: v.vehicle?.id || "sin_id",
        lat: v.position.latitude,
        lon: v.position.longitude,
        route: route_id,
        agency: agency,
        direction: v.trip.directionId ?? "N/A"
      });
    });

    res.json(buses);

  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Error obteniendo datos" });
  }
});

app.get("/stops", (req, res) => {

  const agenciasValidas = ["4", "5", "11"];

  // Obtener trips válidos
  const tripsValidos = Object.keys(trips).filter(trip_id => {
    const route_id = trips[trip_id];
    const agency = route_id.split("_")[0];
    return agenciasValidas.includes(agency);
  });

  // Obtener stops usados por esos trips
  const stopIdsValidos = new Set();

  tripsValidos.forEach(trip_id => {
    const stopsDeTrip = stopTimes[trip_id] || [];
    stopsDeTrip.forEach(stop_id => stopIdsValidos.add(stop_id));
  });

  // Filtrar stops reales
  const stopsFiltrados = stops.filter(stop =>
    stopIdsValidos.has(stop.stop_id)
  );

  res.json(stopsFiltrados.map(s => ({
    id: s.stop_id,
    name: s.stop_name,
    lat: parseFloat(s.stop_lat),
    lon: parseFloat(s.stop_lon)
  })));
});

app.get("/stops-jerarquia", (req, res) => {

  const resultado = {};

  routeStops.forEach(row => {

    const route = row.route; // ejemplo: 4_301
    const agencia = route.split("_")[0];
    const ruta = route.split("_")[1];

    if (!["4","5","11"].includes(agencia)) return;

    if (!resultado[agencia]) resultado[agencia] = {};
    if (!resultado[agencia][ruta]) resultado[agencia][ruta] = [];

    resultado[agencia][ruta].push({
      id: row.stop_id,
      name: row.stop_name,
      lat: parseFloat(row.stop_lat),
      lon: parseFloat(row.stop_lon),
      orient: row.orient,
      seq: parseInt(row.stop_seq)
    });
  });

  res.json(resultado);
});

app.get("/version", (req, res) => {
  const path = require("path");

  try {
    const data = fs.readFileSync(path.join(__dirname, "GTFS", "version.json"));
    const json = JSON.parse(data);

    res.json({
      fecha_descarga: json.fecha_descarga || null,
      archivo: json.archivo || "desconocido"
    });

  } catch (error) {
    res.json({
      fecha_descarga: null,
      archivo: "no disponible"
    });
  }
});

let recargando = false;

async function cargarGTFS() {
  if (recargando) {
    console.log("⏳ Recarga en curso, se omite...");
    return;
  }

  recargando = true;

  try {
    stops = [];
    trips = {};
    routes = {};
    stopTimes = {};
    routeStops = [];

    await cargarRoutes();
    await cargarTrips();
    await cargarStops();
    await cargarStopTimes();
    await cargarRouteStops();

    console.log("✅ GTFS recargado");
  } catch (error) {
    console.error("❌ Error cargando GTFS:", error);
  }

  recargando = false;
}

cargarGTFS();

// Recarga cada 10 minutos
setInterval(() => {
  console.log("🔄 Recargando GTFS automáticamente...");
  cargarGTFS();
}, 1000 * 60 * 10);

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor corriendo en puerto", PORT);
});

module.exports = { cargarGTFS };