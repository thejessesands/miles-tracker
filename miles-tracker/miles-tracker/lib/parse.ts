import {PROGRAMS} from './programs';
// Deliberately conservative: a statement must mention the program and an explicit balance label.
// Ambiguous messages are ignored, never silently treated as verified.
const hints:Record<string,RegExp>={
 united:/mileageplus|united airlines/i,american:/aadvantage|american airlines/i,
 delta:/skymiles|delta air lines/i,ba:/british airways|executive club/i,
 singapore:/krisflyer|singapore airlines/i,jetblue:/trueblue|jetblue/i,
 hawaiian:/hawaiianmiles|atmos rewards|hawaiian airlines/i,chase:/ultimate rewards|chase rewards/i,
 hyatt:/world of hyatt|hyatt/i,hilton:/hilton honors/i,ihg:/ihg one rewards|ihg rewards/i
};
const balancePatterns=[
 /(?:available|current|total|ending|new|your)\s+(?:rewards?\s+)?(?:points?|miles?|avios)?\s*balance\s*(?:is|:|of)?\s*([\d,]{1,15})\s*(?:points?|miles?|avios)?/gi,
 /(?:points?|miles?|avios)\s+(?:available|balance)\s*(?:is|:|of)?\s*([\d,]{1,15})/gi,
 /balance\s*(?:is|:|of)\s*([\d,]{1,15})\s*(?:points?|miles?|avios)/gi
];
export function extractBalances(subject:string,body:string){const text=(subject+' '+body).replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/\s+/g,' ').slice(0,150000);const out:{program_id:string,balance:number}[]=[];for(const p of PROGRAMS){if(!hints[p.id].test(text))continue;const found=new Set<number>();for(const pattern of balancePatterns){pattern.lastIndex=0;let match;while((match=pattern.exec(text))!==null){const n=Number(match[1].replace(/,/g,''));if(Number.isSafeInteger(n)&&n>=0)found.add(n);}}if(found.size===1)out.push({program_id:p.id,balance:[...found][0]});}return out;}
export function decodeBase64Url(data:string){return Buffer.from(data.replace(/-/g,'+').replace(/_/g,'/'),'base64').toString('utf8')}
export function collectParts(payload:any):string{let s='';if(payload?.body?.data)s+=decodeBase64Url(payload.body.data)+' ';for(const part of payload?.parts||[])s+=collectParts(part);return s;}
