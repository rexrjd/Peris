import {createContext,useContext} from 'react';
export const ResearchNavigation=createContext<(id?:string)=>void>(()=>{});
export const useResearchNavigation=()=>useContext(ResearchNavigation);
