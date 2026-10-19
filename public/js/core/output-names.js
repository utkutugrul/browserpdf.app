export function outputExtension(type) { return type === 'application/pdf' ? '.pdf' : type === 'image/jpeg' ? '.jpg' : type === 'image/png' ? '.png' : '.bin'; }
export function safeOutputName(value, extension, used = new Set()) {
  let stem = String(value || 'output').normalize('NFC').replace(/[\\/<>:"|?*\u0000-\u001f\u007f]/g, '-').trim().replace(/[. ]+$/g, '');
  if (stem.toLowerCase().endsWith(extension)) stem = stem.slice(0, -extension.length);
  else stem = stem.replace(/\.(?:pdf|png|jpe?g|zip|bin)$/i, '');
  stem = stem.replace(/[. ]+$/g, '').slice(0, 110) || 'output';
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(stem)) stem = '_' + stem;
  let name = stem + extension, n = 2;
  while (used.has(name.toLocaleLowerCase('en'))) name = `${stem} (${n++})${extension}`;
  used.add(name.toLocaleLowerCase('en')); return name;
}
