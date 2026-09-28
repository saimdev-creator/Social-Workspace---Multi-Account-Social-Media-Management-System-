(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.WorkspaceMode=factory();})(globalThis,function(){
  const KEY='social-workspace.preferences.v1';
  class Mode{
    constructor(storage){this.storage=storage;this.demo=true;try{const value=JSON.parse(storage.getItem(KEY)||'{}');this.demo=value.demoMode!==false;}catch{/* Existing demo data is not touched. */}}
    setDemo(enabled){const next=enabled===true;this.storage.setItem(KEY,JSON.stringify({demoMode:next}));this.demo=next;}
  }
  return {Mode};
});
