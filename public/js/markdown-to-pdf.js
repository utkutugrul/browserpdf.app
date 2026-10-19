import {mountDocumentEntry} from './document-entry.js';
const entry=mountDocumentEntry({slug:'markdown-to-pdf',sourceKind:'markdown'});
window.addEventListener('pagehide',()=>{void entry.dispose().catch(()=>{});},{once:true});
