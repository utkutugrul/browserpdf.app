import {mountDocumentEntry} from './document-entry.js';
const entry=mountDocumentEntry({slug:'word-to-pdf',sourceKind:'docx'});
window.addEventListener('pagehide',()=>{void entry.dispose().catch(()=>{});},{once:true});
