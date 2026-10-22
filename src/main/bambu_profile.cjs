const fs = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

const metadata = ['type', 'name', 'inherits', 'from', 'setting_id', 'instantiation', 'include',
  'compatible_printers', 'compatible_printers_condition', 'compatible_prints', 'compatible_prints_condition', 'description', 'filament_id'];

async function readProfile(root, kind, name, ancestors = []) {
  if (typeof name !== 'string' || /[\\/:]/.test(name) || name === '..' || ancestors.includes(name)) {
    throw new Error('Referencia de perfil Bambu no válida.');
  }
  const data = JSON.parse(await fs.readFile(path.join(root, kind, name + '.json'), 'utf8'));
  const chain = [...ancestors, name];
  const result = data.inherits ? await readProfile(root, kind, data.inherits, chain) : {};
  for (const include of data.include || []) Object.assign(result, await readProfile(root, kind, include, chain));
  Object.assign(result, data);
  for (const key of metadata) delete result[key];
  return result;
}

async function loadBambuPencilProfile(root) {
  const machine = 'Bambu Lab A1 0.4 nozzle', process = '0.20mm Standard @BBL A1', filament = 'Bambu PLA Basic @BBL A1';
  const [printer, printing, material] = await Promise.all([
    readProfile(root, 'machine', machine), readProfile(root, 'process', process), readProfile(root, 'filament', filament),
  ]);
  const result = { ...printer, ...printing };
  for (const [key, value] of Object.entries(material)) {
    result[key] = Array.isArray(value) && value.length === 1 ? [value[0], value[0]] : value;
  }
  if (result.printer_model !== 'Bambu Lab A1' || !result.machine_start_gcode || !result.change_filament_gcode) {
    throw new Error('El perfil A1 instalado está incompleto. Actualiza Bambu Studio.');
  }
  return {
    ...result, from: 'project', version: '02.08.04.57',
    printer_settings_id: machine, print_settings_id: process, filament_settings_id: [filament, filament],
    filament_ids: ['GFA00', 'GFA00'], filament_is_support: ['0', '0'],
    inherits_group: ['', '', '', ''], different_settings_to_system: [''],
    filament_map: ['1'], filament_map_2: ['1'], filament_map_mode: 'Auto For Flush',
    curr_bed_type: 'Textured PEI Plate', enable_support: '0', brim_type: 'no_brim', skirt_loops: '0',
    print_sequence: 'by layer', wipe_tower_x: ['12'], wipe_tower_y: ['215'], prime_tower_width: '35', enable_prime_tower: '1',
  };
}

async function findBambu() {
  const roots = [process.env.ProgramFiles, process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  for (const root of roots) {
    const folder = path.join(root, 'Bambu Studio', 'resources', 'profiles', 'BBL');
    try { await fs.access(folder); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    return { profiles: folder, executable: path.join(root, 'Bambu Studio', 'bambu-studio.exe') };
  }
  throw new Error('Instala Bambu Studio con sus perfiles Bambu A1 para generar las placas del lote.');
}

async function getBambuPencilProfile() {
  return loadBambuPencilProfile((await findBambu()).profiles);
}

async function normalizePencilPlates(folder, names) {
  if (!Array.isArray(names) || !names.length || names.some(name => !/^Placa_\d+_Bambu_A1\.3mf$/.test(name))) {
    throw new Error('Listado de placas Bambu no válido.');
  }
  const { executable } = await findBambu();
  const temporary = await fs.mkdtemp(path.join(folder, '.bambu-'));
  try {
    for (const name of names) {
      // System presets and project settings use different serializers; let Bambu write its native schema.
      await run(executable, ['--arrange', '0', '--export-3mf', name, '--outputdir', temporary, path.join(folder, name)],
        { windowsHide: true, timeout: 120000 });
      const result = JSON.parse(await fs.readFile(path.join(temporary, 'result.json'), 'utf8'));
      if (result.return_code !== 0) throw new Error('Bambu Studio: ' + result.error_string);
      await fs.rename(path.join(temporary, name), path.join(folder, name));
    }
  } finally { await fs.rm(temporary, { recursive: true, force: true }); }
}

module.exports = { getBambuPencilProfile, loadBambuPencilProfile, normalizePencilPlates };
