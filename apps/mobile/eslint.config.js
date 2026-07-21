import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";
import { baseConfig } from "@village-fireside/eslint-config/base";

export default defineConfig([expoConfig, ...baseConfig]);
