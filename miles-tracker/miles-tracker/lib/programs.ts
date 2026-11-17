export const PROGRAMS = [
 {id:'united',name:'United MileagePlus',category:'Airlines',unit:'miles',cents:1.2,color:'#3269c5'},
 {id:'american',name:'American AAdvantage',category:'Airlines',unit:'miles',cents:1.4,color:'#e43c46'},
 {id:'delta',name:'Delta SkyMiles',category:'Airlines',unit:'miles',cents:1.1,color:'#b61f43'},
 {id:'ba',name:'British Airways Club',category:'Airlines',unit:'Avios',cents:1.2,color:'#425caa'},
 {id:'singapore',name:'Singapore KrisFlyer',category:'Airlines',unit:'miles',cents:1.3,color:'#cba351'},
 {id:'jetblue',name:'JetBlue TrueBlue',category:'Airlines',unit:'points',cents:1.3,color:'#284d9a'},
 {id:'hawaiian',name:'Hawaiian / Atmos Rewards',category:'Airlines',unit:'points',cents:1.2,color:'#9255a6'},
 {id:'chase',name:'Chase Ultimate Rewards',category:'Credit Cards',unit:'points',cents:1.5,color:'#168b90'},
 {id:'hyatt',name:'World of Hyatt',category:'Hotels',unit:'points',cents:1.7,color:'#8e7762'},
 {id:'hilton',name:'Hilton Honors',category:'Hotels',unit:'points',cents:0.5,color:'#306ca8'},
 {id:'ihg',name:'IHG One Rewards',category:'Hotels',unit:'points',cents:0.5,color:'#9c7751'},
] as const;
export type ProgramId = typeof PROGRAMS[number]['id'];
export type Balance = {program_id:string; balance:number; source:string; verified_at:string|null; evidence?:string|null};
