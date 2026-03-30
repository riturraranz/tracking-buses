const express = require("express");
const cors = require("cors");
const GtfsRealtimeBindings = require("gtfs-realtime-bindings");

const app = express();
app.use(cors());
app.use(express.static("public"));

const fs = require("fs");
const csv = require("csv-parser");
const fetch = require("node-fetch");
const AdmZip = require("adm-zip");
const path = require("path");

let stops = [];
let trips = {};
let routes = {};
let stopTimes = {};
let routeStops = [];
let stopMap = {};

// Leer route_stops.csv
function cargarRouteStops() {
  return new Promise((resolve) => {
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
    let contador = 0;
    fs.createReadStream(path.join(__dirname, "GTFS", "trips.txt"))
      .pipe(csv())
      .on("data", (row) => {
        contador++;
        trips[row.trip_id.trim()] = {
          route_id: row.route_id.trim(),
          direction_id: row.direction_id.trim()
        };
      })
      .on("end", () => {
        console.log("📊 Total trips cargados:", contador);
        if (contador > 0) {
          const muestra = Object.keys(trips).slice(0, 3);
          console.log("📋 Muestra trip_ids:", muestra);
        } else {
          console.log("⚠️ trips.txt se leyó pero no cargó ninguna fila");
        }
        resolve();
      })
      .on("error", (err) => {
        console.error("❌ Error leyendo trips.txt:", err.message);
        resolve();
      });
  });
}

// Leer stops.txt
function cargarStops() {
  return new Promise((resolve) => {
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

      const trip_id = (v.trip.tripId || "").trim();
      const route_id = v.trip.routeId || "";
      if (!route_id.includes("_")) return;
      const agency = route_id.split("_")[0];

      if (!["4", "5", "11"].includes(agency)) return;

      const tripData = trips[trip_id] || {};
      console.log("🔍 trip_id:", trip_id, "| tripData:", JSON.stringify(tripData));

      let direction = "N/A";
      if (tripData.direction_id == "1") {
        direction = "Sur";
      } else if (tripData.direction_id == "0") {
        direction = "Norte";
      }

      const stop_id = v.vehicle?.stopId || v.stopId || null;
      const next_stop_name = stop_id ? (stopMap[stop_id] || "Desconocido") : "No disponible";
      const license_plate = v.vehicle?.licensePlate || "N/A";
      const status = v.currentStatus || "N/A";  

      buses.push({
        id: v.vehicle?.id || "sin_id",
        lat: v.position.latitude,
        lon: v.position.longitude,
        route: route_id,
        agency: agency,
        direction: direction,
        license_plate: license_plate,
        next_stop_name: next_stop_name,
        status: status
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
  const route_id = trips[trip_id]?.route_id || trips[trip_id] || "";
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
  const filePath = path.join(__dirname, "..", "GTFS", "version.json");

  console.log("📂 Buscando version en:", filePath);

  if (!fs.existsSync(filePath)) {
    console.log("❌ version.json NO existe");
    return res.json({
      fecha_descarga: null,
      error: "Archivo no encontrado"
    });
  }

  try {
    const raw = fs.readFileSync(filePath, "utf-8");
    console.log("📄 Contenido version.json:", raw);

    const data = JSON.parse(raw);

    res.json(data);

  } catch (error) {
    console.error("❌ Error leyendo version.json:", error);

    res.json({
      fecha_descarga: null,
      error: "Error leyendo archivo"
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
    // PASO 1: limpiar memoria
    stops = [];
    trips = {};
    routes = {};
    stopTimes = {};
    routeStops = [];
    stopMap = {};
    // PASO 2: cargar datos en memoria
    await cargarRoutes();
    await cargarTrips();
    await cargarStops();
    await cargarStopTimes();
    await cargarRouteStops();
    // PASO 3: construir mapa de paraderos
    stops.forEach(s => {
      stopMap[s.stop_id] = s.stop_name;
    });

    console.log("✅ GTFS cargado desde archivos locales");
  } catch (error) {
    console.error("❌ Error cargando GTFS:", error);
  }

  recargando = false;
}

function programarActualizacionDiaria() {
  const ahora = new Date();
  const proximo = new Date();

  proximo.setHours(5, 0, 0, 0); // 5:00 AM

  if (ahora > proximo) {
    proximo.setDate(proximo.getDate() + 1);
  }

  const delay = proximo - ahora;

  console.log(`⏰ Próxima actualización GTFS en ${Math.round(delay/1000)} segundos`);

  setTimeout(() => {
    console.log("🔄 Ejecutando actualización diaria GTFS...");
    cargarGTFS();

    setInterval(cargarGTFS, 1000 * 60 * 60 * 24); // cada 24h

  }, delay);
}

cargarGTFS();
programarActualizacionDiaria();

const PORT = process.env.PORT || 3000;

app.listen(PORT, "0.0.0.0", () => {
  console.log("Servidor corriendo en puerto", PORT);
});

module.exports = { cargarGTFS };