// Accesos locales (solo escritorio): tarjetas de Inicio que abren archivos HTML de ESTE equipo, p. ej. una guía personal.
// La lista vive únicamente en <userData>/accesos-locales.json: no está en el repositorio ni en los instaladores, y la
// versión web no la ve (el renderer la pide por window.r3dLocal, que la web no expone).
//   { "accesos": [{ "id": "guia", "titulo": "Mi guía", "descripcion": "…", "icono": "🎯", "archivo": "C:\\…\\guia.html" }] }
// También se acepta la lista sola. Solo se abren .html/.htm con ruta completa: nunca ejecutables ni otros tipos.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const MAX_LINKS = 30;
const ID = /^[a-z0-9][a-z0-9-]{0,39}$/;
const HTML = /\.html?$/i;

// Texto de una línea, recortado por caracteres completos (sin partir emojis ni tildes).
const line = (value, max) => (typeof value === 'string' ? [...value.replace(/\s+/g, ' ').trim()].slice(0, max).join('') : '');

function createLocalLinks({ configFile }) {
  const name = path.basename(configFile);

  async function list() {
    let raw;
    try {
      raw = await fs.readFile(configFile, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return { accesos: [], avisos: [] };
      return { accesos: [], avisos: [`No pude leer ${name}: ${err.message}`] };
    }
    let data;
    try {
      data = JSON.parse(raw.replace(/^\uFEFF/, ''));
    } catch (err) {
      return { accesos: [], avisos: [`${name} no es un JSON válido (${err.message}).`] };
    }
    const items = Array.isArray(data) ? data : Array.isArray(data?.accesos) ? data.accesos : null;
    if (!items) return { accesos: [], avisos: [`${name} debe tener la forma { "accesos": [ … ] }.`] };

    const accesos = [], avisos = [], ids = new Set();
    for (const [index, item] of items.slice(0, MAX_LINKS).entries()) {
      const where = `Acceso ${index + 1}`;
      if (!item || typeof item !== 'object' || Array.isArray(item)) { avisos.push(`${where}: no es un objeto.`); continue; }
      const titulo = line(item.titulo, 80);
      if (!titulo) { avisos.push(`${where}: falta "titulo".`); continue; }
      const label = `«${titulo}»`;
      const id = line(item.id, 41).toLowerCase();
      if (!ID.test(id)) { avisos.push(`${label}: "id" debe tener minúsculas, números o guiones (máximo 40).`); continue; }
      if (ids.has(id)) { avisos.push(`${label}: el id "${id}" está repetido.`); continue; }
      const archivo = typeof item.archivo === 'string' ? item.archivo.trim() : '';
      if (!archivo || !path.isAbsolute(archivo)) { avisos.push(`${label}: "archivo" debe ser una ruta completa, p. ej. C:\\Carpeta\\guia.html.`); continue; }
      if (!HTML.test(archivo)) { avisos.push(`${label}: solo se abren archivos .html.`); continue; }
      ids.add(id);
      const full = path.normalize(archivo);
      let existe = false;
      try { existe = (await fs.stat(full)).isFile(); } catch { /* falta el archivo: la tarjeta lo avisa */ }
      accesos.push({ id, titulo, descripcion: line(item.descripcion, 160), icono: line(item.icono, 8) || '🔗', archivo: full, nombre: path.basename(full), existe });
    }
    if (items.length > MAX_LINKS) avisos.push(`Solo se muestran los primeros ${MAX_LINKS} accesos.`);
    return { accesos, avisos };
  }

  // El acceso listo para abrir (se relee el archivo: lo que vale es lo que dice ahora, no lo que mostró Inicio).
  async function find(id) {
    const link = (await list()).accesos.find((item) => item.id === id);
    if (!link) throw new Error(`Ese acceso ya no está en ${name}.`);
    if (!link.existe) throw new Error(`No encuentro ${link.archivo}. ¿Se movió o se borró?`);
    return link;
  }

  return { configFile, list, find };
}

module.exports = { createLocalLinks, MAX_LINKS };
