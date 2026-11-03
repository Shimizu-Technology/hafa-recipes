import { createContext, useContext } from "react";
import { getLook, type LookId } from "./looks";
export const LookContext = createContext({ ...getLook("current"), enabled: false, pending: false, error: "", setLook: (_id: LookId) => {} });
export const useLook = () => useContext(LookContext);
