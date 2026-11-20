export function bindEvent(target,type,handler,reportError) {
  target.addEventListener(type,async event=>{try{await handler(event);}catch(error){reportError(error);}});
}
