import path from "node:path";
import { cosmiconfig, defaultLoaders } from "cosmiconfig";
import { TypeScriptLoader } from "cosmiconfig-typescript-loader";
const moduleName = "commitlint";
const searchStrategy = "global";
export async function loadConfig(cwd, configPath) {
    let tsLoaderInstance;
    const tsLoader = (...args) => {
        if (!tsLoaderInstance) {
            tsLoaderInstance = TypeScriptLoader();
        }
        return tsLoaderInstance(...args);
    };
    const explorer = cosmiconfig(moduleName, {
        searchStrategy,
        searchPlaces: [
            // cosmiconfig overrides default searchPlaces if any new search place is added (For e.g. `*.ts` files),
            // we need to manually merge default searchPlaces from https://github.com/davidtheclark/cosmiconfig#searchplaces
            "package.json",
            "package.yaml",
            `.${moduleName}rc`,
            `.${moduleName}rc.json`,
            `.${moduleName}rc.yaml`,
            `.${moduleName}rc.yml`,
            `.${moduleName}rc.js`,
            `.${moduleName}rc.cjs`,
            `.${moduleName}rc.mjs`,
            `${moduleName}.config.js`,
            `${moduleName}.config.cjs`,
            `${moduleName}.config.mjs`,
            // files supported by TypescriptLoader
            `.${moduleName}rc.ts`,
            `.${moduleName}rc.cts`,
            `.${moduleName}rc.mts`,
            `${moduleName}.config.ts`,
            `${moduleName}.config.cts`,
            `${moduleName}.config.mts`,
        ],
        loaders: {
            ".ts": tsLoader,
            ".cts": tsLoader,
            ".mts": tsLoader,
            ".cjs": defaultLoaders[".cjs"],
            ".js": defaultLoaders[".js"],
        },
    });
    const explicitPath = configPath ? path.resolve(cwd, configPath) : undefined;
    const explore = explicitPath ? explorer.load : explorer.search;
    const searchPath = explicitPath ? explicitPath : cwd;
    const local = await explore(searchPath);
    if (local) {
        return local;
    }
    return null;
}
//# sourceMappingURL=load-config.js.map