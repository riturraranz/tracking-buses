const cron = require("node-cron");
const axios = require("axios");
const fs = require("fs");
const path = require("path");
const AdmZip = require("adm-zip");

const URL_GTFS = "https://vdvlima.utryt.com.co:9015/interfaces/gtfs";
const RUTA_ZIP = path.join(__dirname, "gtfs.zip");
const RUTA_GTFS = path.join(__dirname, "GTFS");

// Función principal
async function descargarYActualizarGTFS() {
  try {
    console.log("⬇️ Descargando GTFS...");

    const response = await axios({
      url: URL_GTFS,
      method: "GET",
      responseType: "stream"
    });

    // Guardar ZIP
    const writer = fs.createWriteStream(RUTA_ZIP);
    response.data.pipe(writer);

    await new Promise((resolve, reject) => {
      writer.on("finish", resolve);
      writer.on("error", reject);
    });

    console.log("✅ ZIP descargado");

    // Eliminar carpeta anterior
    if (fs.existsSync(RUTA_GTFS)) {
      fs.rmSync(RUTA_GTFS, { recursive: true, force: true });
    }

    fs.mkdirSync(RUTA_GTFS);

    // Descomprimir
    const zip = new AdmZip(RUTA_ZIP);
    zip.extractAllTo(RUTA_GTFS, true);

    console.log("📂 GTFS actualizado correctamente");

  } catch (error) {
    console.error("❌ Error actualizando GTFS:", error.message);
  }
}

// Ejecutar todos los días a las 5 AM (Perú)
cron.schedule("0 5 * * *", () => {
  console.log("⏰ Ejecutando descarga programada...");
  descargarYActualizarGTFS();
}, {
  timezone: "America/Lima"
});

// Ejecutar al iniciar
descargarYActualizarGTFS();