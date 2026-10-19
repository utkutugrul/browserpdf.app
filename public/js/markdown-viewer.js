import {mountDocumentEntry} from './document-entry.js';
const entry=mountDocumentEntry({slug:'markdown-viewer',sourceKind:'markdown'});
window.addEventListener('pagehide',()=>{void entry.dispose().catch(()=>{});},{once:true});
