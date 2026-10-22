const fs = require('node:fs/promises');
const path = require('node:path');

const safeName = name => typeof name === 'string' && name.length > 0 && name.length <= 120
  && !/[<>:"/\\|?*\x00-\x1f]/.test(name) && !/[ .]$/.test(name)
  && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name);

async function writeNewExportFolder(parent, folderName, files, prepare = null) {
  if (!safeName(folderName) || !Array.isArray(files) || !files.length) throw new Error('Carpeta o archivos de lote no válidos.');
  const names = new Set();
  const data = files.map(file => {
    if (!safeName(file.name) || names.has(file.name.toLowerCase())) throw new Error('Nombre de archivo de lote no válido o repetido.');
    names.add(file.name.toLowerCase());
    return { name: file.name, data: Buffer.from(file.data) };
  });
  const folder = await fs.mkdtemp(path.join(parent, folderName + '_'));
  try {
    for (const file of data) await fs.writeFile(path.join(folder, file.name), file.data, { flag: 'wx' });
    if (prepare) await prepare(folder);
    return folder;
  } catch (error) {
    await fs.rm(folder, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { writeNewExportFolder };
