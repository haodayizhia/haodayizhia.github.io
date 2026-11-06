'use strict';
let publishFiles=[],publishKind='merged';
function showPublish(){
 stopReplay();renderDataPanel();$('dataDialog').showModal();
 document.querySelector('[data-data-tab="source"]').click();$('ownerPublish').open=true;
 $('ownerPublish').scrollIntoView({block:'nearest'});$('publishToken').focus();
}
$('openPublish').addEventListener('click',showPublish);
$('choosePublishMerged').addEventListener('click',()=>$('publishMerged').click());
$('choosePublishFolder').addEventListener('click',()=>$('publishFolder').click());
for(const [id,kind] of [['publishMerged','merged'],['publishFolder','directory']])$(id).addEventListener('change',event=>{
 publishFiles=[...event.target.files].filter(f=>/\.csv$/i.test(f.name));publishKind=kind;
 $('publishSelection').textContent=publishFiles.length?`已选 ${publishFiles.length.toLocaleString()} 个CSV · ${fmt(publishFiles.reduce((n,f)=>n+f.size,0)/1024/1024)} MB`:'尚未选择数据';
 $('publishSubmit').disabled=!publishFiles.length;
});
$('publishSubmit').addEventListener('click',async()=>{
 if(sourceBusy)return;
 const token=$('publishToken').value.trim();if(!token){$('publishToken').reportValidity();return;}
 if(!publishFiles.length)return;
 const output=$('publishStatus');setSourceBusy(true);saveWorkspaceNow();stopReplay();
 try{
  output.textContent='正在本地校验文件…';
  await AtlasData.importFiles(publishFiles,publishKind,p=>output.textContent=p.message);
  await bootWorkspace();output.textContent='正在准备公开数据…';
  const snapshot=await AtlasData.snapshot();
  const result=await publishAtlasSnapshot({token,snapshot,progress:message=>output.textContent=message});
  output.textContent=result.unchanged?'数据与网站一致，无需重复发布。':'数据已提交，部署成功后所有访客即可看到。';
  const link=document.createElement('a');link.href='https://github.com/haodayizhia/haodayizhia.github.io/actions/workflows/deploy.yml';link.target='_blank';link.rel='noopener noreferrer';link.textContent=' 查看部署进度 ↗';output.append(link);
 }catch(error){output.textContent='发布未完成：'+error.message+' 如网络在提交时断开，请检查部署记录后重试。';}
 finally{$('publishToken').value='';setSourceBusy(false);$('publishSubmit').disabled=!publishFiles.length;}
});
