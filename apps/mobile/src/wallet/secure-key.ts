import * as SecureStore from "expo-secure-store";
import { createKeyStorage } from "./key-storage";

const storage = createKeyStorage(SecureStore);

export const loadOrCreatePrivateKey = storage.load;
export const resetPrivateKey = storage.replace;
