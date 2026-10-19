import { documentSession, createOperationScope, takeChainedFile, clearResult, showError } from './tool-ui.js';

// Empty routes load no parser, fonts, PDF runtime or workflow store.
export function mountDocumentEntry({slug,sourceKind}){
  const input=document.getElementById('fileInput'),dropzone=document.getElementById('dropzone'),source=document.getElementById('mdSource'),root=document.getElementById('documentWorkspace');
  const initialScope=createOperationScope(),lifetime=new AbortController();let intent=0,disposed=false,workspace,pending,latest;
  const listeners=[];
  const on=(node,event,handler)=>{if(node){node.addEventListener(event,handler);listeners.push(()=>node.removeEventListener(event,handler));}};
  const tuple=()=>{const {taskId,revision,generation}=documentSession.snapshot();return {taskId,revision,generation};};
  const same=(a,b)=>a.taskId===b.taskId&&a.revision===b.revision&&a.generation===b.generation;
  function invalidate(){intent++;initialScope.cancel();clearResult();}
  function descriptor(kind,value){const token=intent,owner=tuple(),intentCurrent=()=>!disposed&&token===intent;return {kind,...value,owner,intentCurrent,isCurrent:()=>intentCurrent()&&same(owner,tuple())};}
  async function open(){
    if(workspace||disposed)return workspace;
    if(!pending)pending=(async()=>{const module=await import('./document-model-workspace.js');if(disposed)return;const openingSource=latest?.isCurrent()?latest:undefined;workspace=await module.openDocumentModelWorkspace({slug,sourceKind,initialSource:openingSource},{signal:lifetime.signal,isCurrent:()=>!disposed,onClear:()=>{latest=null;},onSourceAccepted:()=>{latest=null;}});if(latest&&latest!==openingSource&&latest.isCurrent())void workspace.selectSource(latest);return workspace;})().catch(error=>{pending=null;if(!disposed&&error?.name!=='AbortError')showError(error.message);});
    return pending;
  }
  const nativeFiles=files=>{const count=files?.length??0,values=[];for(let i=0;i<Math.min(count,49);i++)values.push(files[i]);if(!values.length)return;invalidate();const sources=values.filter(f=>sourceKind==='docx'?/\.docx$/i.test(f.name):/\.(md|markdown|txt)$/i.test(f.name)),file=sources.length===1?sources[0]:values[0],localImages=values.filter(f=>f!==file);latest=descriptor('file',{file,localImages,selectionValid:sources.length===1&&count<=49&&(sourceKind!=='docx'||count===1)});if(workspace)void workspace.selectSource(latest).catch(error=>showError(error.message));else void open();};
  on(input,'change',()=>{nativeFiles(input.files);if(!workspace)input.value='';});
  on(dropzone,'click',event=>{if(event.target!==input)input.click();});
  on(dropzone,'keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();input.click();}});
  for(const name of ['dragenter','dragover'])on(dropzone,name,event=>{event.preventDefault();dropzone.classList.add('dragover');});
  for(const name of ['dragleave','drop'])on(dropzone,name,event=>{event.preventDefault();dropzone.classList.remove('dragover');if(name==='drop')nativeFiles(event.dataTransfer.files);});
  on(source,'input',()=>{invalidate();latest=null;if(!workspace)void open();});
  on(root,'click',event=>{
    const action=event.target.closest('button')?.id;
    if(action==='clearBtn'){invalidate();latest=null;if(!workspace){if(source)source.value='';const url=new URL(location.href);url.searchParams.delete('workflow');url.searchParams.delete('file');history.replaceState(null,'',url);if(same(initialOwner,tuple()))documentSession.clear();}}
    else if(['applyMarkdownBtn','loadExampleBtn','copyBtn','prepareMarkdownBtn'].includes(action)&&!workspace){invalidate();if(action==='loadExampleBtn'&&source)source.value='# Project notes\n\nA **local** document with a table.\n\n7. First item\n8. Second item\n\n| Name | Value |\n| --- | --- |\n| Example | 12 |\n';latest=descriptor(action==='copyBtn'?'copy':action==='prepareMarkdownBtn'?'markdown':'source',{text:source?.value??''});void open();}
  });
  // Capture intent and canonical tuple before the first descriptor/store await.
  const initialIntent=intent,initialOwner=tuple(),operation=initialScope.begin();
  const initialCurrent=()=>!disposed&&initialIntent===intent&&operation.isCurrent()&&same(initialOwner,tuple());
  if(new URL(location.href).searchParams.has('workflow'))void(async()=>{try{const file=await takeChainedFile({signal:operation.signal,isCurrent:initialCurrent});if(!file||!initialCurrent())return;latest={kind:'file',file,owner:initialOwner,intentCurrent:()=>!disposed&&initialIntent===intent&&operation.isCurrent(),isCurrent:initialCurrent};await open();}catch(error){if(initialCurrent()&&error?.name!=='AbortError')showError(error.message);}})();
  return {async dispose(){if(disposed)return;disposed=true;initialScope.cancel();lifetime.abort();listeners.forEach(remove=>remove());await pending;await workspace?.dispose();}};
}
