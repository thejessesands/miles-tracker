export const PROGRAMS = [
 {id:'united',name:'United MileagePlus',category:'Airlines',unit:'miles',color:'#3269c5'},
 {id:'american',name:'American AAdvantage',category:'Airlines',unit:'miles',color:'#e43c46'},
 {id:'delta',name:'Delta SkyMiles',category:'Airlines',unit:'miles',color:'#b61f43'},
 {id:'ba',name:'British Airways Club',category:'Airlines',unit:'Avios',color:'#425caa'},
 {id:'singapore',name:'Singapore KrisFlyer',category:'Airlines',unit:'miles',color:'#cba351'},
 {id:'jetblue',name:'JetBlue TrueBlue',category:'Airlines',unit:'points',color:'#284d9a'},
 {id:'hawaiian',name:'Hawaiian / Atmos Rewards',category:'Airlines',unit:'points',color:'#9255a6'},
 {id:'chase',name:'Chase Ultimate Rewards',category:'Credit Cards',unit:'points',color:'#168b90'},
 {id:'hyatt',name:'World of Hyatt',category:'Hotels',unit:'points',color:'#8e7762'},
 {id:'hilton',name:'Hilton Honors',category:'Hotels',unit:'points',color:'#306ca8'},
 {id:'ihg',name:'IHG One Rewards',category:'Hotels',unit:'points',color:'#9c7751'},
] as const;
export type ProgramId = typeof PROGRAMS[number]['id'];
export type Balance = {
  program_id: string;
  balance: number;
  membership_number: string | null;
  source: string;
  verified_at: string | null;
  evidence?: string | null;
};
