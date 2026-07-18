export function expandEnvVars(route: string): string {
    return route.replace(
        /\$([A-Z_]+)|%([A-Z_]+)%/gi,
        (_, unixVar: string | undefined, winVar: string | undefined) => {
            const key = unixVar ?? winVar ?? "";
            return process.env[key] ?? "";
        }
    );
}
