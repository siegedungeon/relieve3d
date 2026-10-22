import { generatePencilBatch } from './core/pencil_batch.js';

export class PencilBatchUI {
  constructor({ toast, openProject }) {
    const $ = id => document.getElementById(id);
    this.input = $('pencilBatchNames');
    this.status = $('pencilBatchStatus');
    this.generate = $('pencilBatchGenerate');
    this.cancel = $('pencilBatchCancel');
    this.results = $('pencilBatchResults');
    this.toast = toast;
    this.openProject = openProject;
    this.key = 'r3d.pencilBatch.names';
    try { this.input.value = localStorage.getItem(this.key) || ''; }
    catch (error) { this.storageError(error); }
    this.input.addEventListener('input', () => {
      try { localStorage.setItem(this.key, this.input.value); }
      catch (error) { this.storageError(error); }
    });
    this.generate.onclick = () => this.run();
    this.cancel.onclick = () => this.controller?.abort();
  }

  storageError(error) {
    console.error(error);
    this.toast('No se pudo recordar el listado: ' + error.message, true);
  }

  setStatus(state, message) {
    this.status.dataset.state = state;
    this.status.textContent = message;
  }

  async run() {
    if (this.controller) return;
    this.controller = new AbortController();
    this.generate.disabled = this.input.disabled = true;
    this.cancel.hidden = false;
    this.results.replaceChildren();
    try {
      this.setStatus('generating', 'Cargando perfil Bambu A1 instalado…');
      const profile = await window.api.pencilBatchProfile();
      const batch = await generatePencilBatch(this.input.value, {
        profile,
        signal: this.controller.signal,
        onProgress: ({ completed, total, name }) => this.setStatus('generating', `${completed}/${total} · ${name}`),
      });
      this.cancel.hidden = true;
      this.setStatus('saving', 'Elige dónde guardar la carpeta nueva del lote.');
      const folder = await window.api.saveFilesToFolder({ files: batch.files, folderName: 'Lapiceros_Matemasie_Morado_Blanco', bambuPlates: batch.plateFiles });
      if (!folder) { this.setStatus('cancelled', 'Guardado cancelado. No se creó ningún archivo.'); return; }
      for (const model of batch.models) {
        const button = document.createElement('button');
        button.className = 'chip'; button.textContent = model.name;
        button.title = model.size.map(n => n.toFixed(2)).join(' × ') + ' mm · Abrir proyecto editable';
        button.onclick = () => this.openProject(new File([model.project], model.file + '.r3d'));
        this.results.append(button);
      }
      this.setStatus('saved', `${batch.models.length} nombres · ${batch.plates} placa(s). Guardado en: ${folder}`);
      this.toast('Lote completo guardado. Pulsa un nombre para verlo.');
    } catch (error) {
      if (error.name === 'AbortError') this.setStatus('cancelled', 'Lote cancelado. Tu diseño no se modificó.');
      else {
        console.error(error);
        this.setStatus('error', error.message);
        this.toast('No se generó el lote: ' + error.message, true);
      }
    } finally {
      this.controller = null;
      this.generate.disabled = this.input.disabled = false;
      this.cancel.hidden = true;
    }
  }
}
