/** Inference metadata comes from the selected server adapter, never the answer text. */
export function modelLabel(model:{id:string;name:string},provider:string,reported?:unknown){
 const id=typeof reported==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:/@+-]{0,179}$/.test(reported)?reported:model.id;
 return `${model.name}${model.name===id?'':` (${id})`} · ${provider}`;
}
