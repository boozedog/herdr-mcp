{
  description = "herdr-mcp: stdio MCP server for Herdr multi-agent coordination";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    deno2nix.url = "github:hzrd149/deno2nix";
    deno2nix.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = { self, nixpkgs, deno2nix }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);
      version = "0.3.0";

      msgpackrPrefetch = [
        "npm:@msgpackr-extract/msgpackr-extract-linux-x64@3.0.4"
        "npm:@msgpackr-extract/msgpackr-extract-linux-arm64@3.0.4"
        "npm:@msgpackr-extract/msgpackr-extract-linux-arm@3.0.4"
      ];

      # FOD hash for deno2nix `mkDenoDeps` (shared across Linux arches when all
      # msgpackr-extract variants are prefetched). Refresh per README.
      denoDepsHash = "sha256-9roRpRg26WGeBsMWSvOHkr/9SOsTvO5ke6kqE+8k580=";

      # Build dependency FOD on x86_64-linux so hashes can be refreshed from one
      # host (vendor includes all Linux msgpackr-extract variants).
      linuxPkgs = import nixpkgs {
        system = "x86_64-linux";
        overlays = [ deno2nix.overlays.default ];
      };
      denoDeps = linuxPkgs.mkDenoDeps {
        pname = "herdr-mcp";
        inherit version;
        src = self;
        entrypoint = "src/main.ts";
        hash = denoDepsHash;
        installFlags = msgpackrPrefetch;
      };
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs {
            inherit system;
            overlays = [ deno2nix.overlays.default ];
          };
        in
        {
          herdr-mcp = pkgs.buildDenoApplication {
            pname = "herdr-mcp";
            inherit version;
            src = self;
            entrypoint = "src/main.ts";
            inherit denoDeps;
            deno = pkgs.deno;
            # -A matches deno task dev/install: env, subprocess (herdr), cache.
            # --vendor uses the deno2nix vendor/ tree (--cached-only alone hits JSR).
            runFlags = [ "-A" "--vendor" ];
            meta.mainProgram = "herdr-mcp";
          };

          herdr-mcp-deno-deps = denoDeps;
          default = self.packages.${system}.herdr-mcp;
        });

      apps = forAllSystems (system:
        let
          pkg = self.packages.${system}.herdr-mcp;
        in
        {
          herdr-mcp = {
            type = "app";
            program = "${pkg}/bin/herdr-mcp";
          };
          default = self.apps.${system}.herdr-mcp;
        });

      devShells = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
        in
        {
          default = pkgs.mkShell {
            packages = [ pkgs.deno ];
          };
        });
    };
}
