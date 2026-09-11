// All observations in this module are generated examples, not market observations.
export const stamp = '2026-09-10T12:00:00.000Z';
export const companies = ['NVDA','MSFT','AAPL','AMD','TSM'].map((ticker,i)=>({
 id:ticker,ticker,name:`Demo ${['Semiconductors','Software','Devices','Compute','Foundry'][i]}`,
 role:i<3?'Core':'Supplier',sector:'Technology',cik:String(9000000+i),hasSecData:false,
 revenue:40e9+i*10e9,netIncome:8e9+i*2e9,rnd:4e9+i*1e9,marketCap:400e9+i*50e9,
}));
export function series(id='SP500') {
 const seed=[...id].reduce((s,c)=>s+c.charCodeAt(0),0);
 const bases={SP500:4800,NASDAQCOM:16000,DJIA:38000,VIXCLS:18,CPIAUCSL:310,ICSA:220000,M2SL:21000,DEXUSEU:1.08,DCOILWTICO:75,DCOILBRENTEU:80,DTWEXBGS:120,UMCSENT:70};
 const base=bases[id]??(id.startsWith('T10')?0.3:4.2);
 return {demo:true,observations:Array.from({length:960},(_,i)=>({date:new Date(Date.UTC(2023,0,1+i)).toISOString().slice(0,10),value:String(+(base*(1+0.08*i/960+0.025*Math.sin(i/32+seed))).toFixed(4))}))};
}
export function summary(ticker='NVDA') {
 const co=companies.find(c=>c.ticker===ticker)||{...companies[0],ticker,id:ticker};
 return {demo:true,ticker,name:co.name,exists:true,identity:{name:co.name,ticker,sector:'Technology',industry:'Synthetic technology',exchanges:['DEMO'],sic:'3570',sicDescription:'Illustrative technology business',country:'US'},
 business:{description:'A fictional technology company used to demonstrate company research workflows.',employees:{count:18000,asOf:"2025-12-31",quote:"Synthetic example"}},
 scale:{revenue:co.revenue,netIncome:co.netIncome,marketCap:co.marketCap},relationships:{supplier:[{ticker:'TSM',name:'Demo Foundry'}],customer:[],partner:[],competitor:[]},
 competitors:[],concentration:[],outlook:{catalysts:[],guidance:null},sources:[],absent:{},updatedAt:stamp};
}
export const alerts={demo:true,channel:{channel:'demo',configured:false},sources:[{
 id:'demo',title:'Synthetic price monitor',rule:'Illustrative one-percent move',summary:'Demo index −1.20% · synthetic event',running:false,active:false,
 source:{name:'Generated fixtures',polls:1,errors:0,lastOk:stamp},facts:[{label:'Mode',value:'Offline simulation'}],actions:[],detail:null,
 log:[{at:stamp,text:'Synthetic index move −1.20%',events:[],delivery:{ok:true,channel:'demo'}}],
}]};
export function payload(route,query={}) {
 if(route==='/fred')return series(query.series);
 if(route==='/health')return {ok:true,demo:true};
 if(route==='/version')return {version:'public-demo-1'};
 if(route.startsWith('/refresh'))return {ok:true,running:false,state:'done',results:[],demo:true};
 if(route==='/calendar')return {demo:true,start:'2026-09-10',end:'2026-09-30',generated:stamp,events:[{date:'2026-09-11',time:'8:30 AM',name:'Sample inflation release',cat:'econ',src:'Synthetic fixture',note:'Illustrative scheduled event',sortMins:510},{date:'2026-09-14',time:'After close',name:'Sample earnings release',cat:'earnings',src:'Synthetic fixture',companies:[{symbol:'NVDA',name:'Demo Semiconductors',sector:'Technology',marketCap:400e9,when:'After close'}]}]};
 if(route==='/news')return {demo:true,updated:stamp,items:['Demand rises in illustrative semiconductor scenario','Synthetic yield curve steepens','Sample earnings show margin expansion'].map((title,i)=>({title,date:stamp,pubDate:stamp,source:'Demo News',theme:['Technology','Rates','Earnings'][i],themes:['Demo'],link:'#news',description:'Fictional headline generated for the public demonstration.'}))};
 if(route==='/alerts')return alerts;
 if(route==='/alerts/evidence')return {demo:true,entries:alerts.sources[0].log.map(l=>({...l,sourceId:'demo',sourceTitle:'Synthetic price monitor',outcome:'test'})),feeds:[]};
 if(route==='/graph/data')return {demo:true,graph:{nodes:companies,links:[{source:'NVDA',target:'TSM',type:'supplier',relationship:'Synthetic supply relationship'},{source:'MSFT',target:'NVDA',type:'customer'}]},earnings:{},sources:{},signals:[]};
 if(route==='/graph/tickers')return companies.filter(c=>c.ticker.includes((query.q||'').toUpperCase()));
 if(route==='/graph/concentration/all')return {};
 if(route==='/peers/summary')return summary(query.ticker);
 if(route==='/peers/resolve')return {demo:true,ticker:query.ticker||'NVDA',name:summary(query.ticker).name,cik:'9000000'};
 if(route==='/peers/notes/index')return {};
 if(route==='/peers/notes')return {demo:true,exists:true,note:'Synthetic company used for the public demo.'};
 if(route==='/peers/suggest')return {demo:true,peers:companies};
 if(route==='/insider/vocab')return {roles:[],sectors:[],screens:[],screen_groups:[]};
 if(route==='/insider/stats')return {demo:true,filings:5,transactions:5,issuers:5,owners:5};
 if(route==='/insider/screener')return {demo:true,rows:companies.map((c,i)=>({ticker:c.ticker,issuer_name:c.name,owner_name:`Demo Officer ${i+1}`,filing_datetime:stamp,transaction_date:'2026-09-09',transaction_code:'P',price:100+i*10,shares:1000,value:100000+i*10000,is_officer:true,officer_title:'CEO'})),total:5,limit:100,offset:0};
 if(route==='/insider/prices'){ const obs=series('SP500').observations.slice(-180); const values=obs.map(o=>Number(o.value)/40); return {demo:true,series:Object.fromEntries((query.tickers||'NVDA').split(',').map(t=>[t,{dates:obs.map(o=>o.date),values,close:values,open:values.map(v=>v*.998),high:values.map(v=>v*1.01),low:values.map(v=>v*.99),volume:values.map(()=>1000000)}]))}; }
 if(route==='/management')return {demo:true,ticker:query.ticker,name:summary(query.ticker).name,officers:[],directors:[],owners:[],sources:[],absent:{}};
 if(route==='/industry')return {demo:true,ticker:query.ticker,name:summary(query.ticker).name,classification:{sic:'3570',sector:'Technology'},sources:[],offerings:[]};
 if(route.startsWith('/outlook'))return {demo:true,ticker:query.ticker,name:summary(query.ticker).name,risks:[],catalysts:[],analysts:[],sources:[]};
 return null;
}
