import type {SeaActivity,SeaConditions,WaterDecision} from '../world/v12-types';
const cache=new Map<number,number[]>();
function rng(seed:number){return ()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t^=t+Math.imul(t^t>>>7,61|t);return ((t^t>>>14)>>>0)/4294967296;};}
/** daily-wave-v1: UTC is used only to enumerate civil dates (never to choose today's date).
 * Fisher-Yates year permutation, fixed seed year XOR 0x64777631; date seed chooses decimetres. */
export function waveHeight(yyyymmdd:string|number):number {
 const text=String(yyyymmdd);if(!/^\d{8}$/.test(text))throw Error('日期須為 YYYYMMDD');
 const year=+text.slice(0,4),month=+text.slice(4,6),day=+text.slice(6),date=new Date(Date.UTC(year,month-1,day));
 if(year<1900||date.getUTCFullYear()!==year||date.getUTCMonth()!==month-1||date.getUTCDate()!==day)throw Error('無效日期');
 const n=(Date.UTC(year+1,0,1)-Date.UTC(year,0,1))/86400000,index=(+date-Date.UTC(year,0,1))/86400000;
 if(!cache.has(year)){const order=Array.from({length:n},(_,i)=>i),random=rng(year^0x64777631);for(let i=n-1;i>0;i--){const j=Math.floor(random()*(i+1));[order[i],order[j]]=[order[j],order[i]];}const rank=Array(n);order.forEach((d,i)=>rank[d]=i);cache.set(year,rank);}
 const rank=cache.get(year)![index],u=rng(+text)(),dm=rank<Math.floor(n*.03)?20+Math.floor(u*7):rank<Math.round(n*.20)?10+Math.floor(u*10):3+Math.floor(u*7);
 return dm/10;
}
export function evaluateSea(activity:SeaActivity,c:SeaConditions):WaterDecision {
 const reasons:WaterDecision['reasons']=[];
 if(c.period==='night')reasons.push('night');if(c.typhoonWarning)reasons.push('typhoon');if(c.thunder)reasons.push('thunder');if(c.operatorClosed)reasons.push('operator');
 if(c.waveHeightM>=2)reasons.push('wave-2');else if(c.waveHeightM>=1&&!['surf-class','supervised-training'].includes(activity))reasons.push('wave-1');
 return {allowed:!reasons.length,recall:!!reasons.length,reasons};
}
export function localDate(now=new Date()){return `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;}
export function seaConditions(period:SeaConditions['period'],params=new URLSearchParams(),now=new Date()):SeaConditions {
 const date=localDate(now),c:SeaConditions={date,period,waveHeightM:waveHeight(date),typhoonWarning:false,thunder:false,operatorClosed:false,qaOverride:false};
 if(params.get('qa')!=='1')return c;
 const raw=params.get('qaWave'),h=Number(raw);if(raw!==null&&raw.trim()!==''&&Number.isFinite(h)&&h>=0&&h<=10){c.waveHeightM=Math.floor(h*10+1e-9)/10;c.qaOverride=true;}
 const sea=params.get('qaSea');if(sea&&['clear','thunder','typhoon','closed'].includes(sea)){c.thunder=sea==='thunder';c.typhoonWarning=sea==='typhoon';c.operatorClosed=sea==='closed';c.qaOverride=true;}
 return c;
}
/** Evaluated each update and explicitly on visibility restoration; never persisted. */
export class SeaPolicyClock {
 conditions:SeaConditions;
 constructor(private params=new URLSearchParams(),private now=()=>new Date()){this.conditions=seaConditions('day',params,now());}
 update(period:SeaConditions['period']){this.conditions=seaConditions(period,this.params,this.now());return this.conditions;}
}

export function waterReasons(decision:WaterDecision){const labels:Record<WaterDecision['reasons'][number],string>={'night':'夜間關閉','wave-1':'浪高達 1 公尺','wave-2':'浪高達 2 公尺','typhoon':'颱風警報','thunder':'打雷','operator':'管理關閉'};return decision.reasons.map(r=>labels[r]).join('、');}
