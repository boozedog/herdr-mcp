{
  description = "herdr-mcp: stdio MCP server for Herdr multi-agent coordination";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" ];
      forAllSystems = f: nixpkgs.lib.genAttrs systems (system: f system);

      # One Linux FOD for all supported systems. Prefetch every Linux
      # msgpackr-extract optional dep so aarch64 does not need its own hash.
      denoCache = nixpkgs.legacyPackages.x86_64-linux.stdenv.mkDerivation {
        pname = "herdr-mcp-deno-cache";
        version = "0.2.0";
        src = ./.;
        nativeBuildInputs = [ nixpkgs.legacyPackages.x86_64-linux.deno ];
        buildPhase = ''
          export DENO_DIR=$out
          deno cache --lock=deno.lock src/main.ts
          deno cache \
            npm:@msgpackr-extract/msgpackr-extract-linux-x64@3.0.4 \
            npm:@msgpackr-extract/msgpackr-extract-linux-arm64@3.0.4 \
            npm:@msgpackr-extract/msgpackr-extract-linux-arm@3.0.4
        '';
        installPhase = "true";
        outputHash = "sha256-B5tdC4IuH5IGhxNBKCfkgA3aGETYOgoU+VS9dor/OPo=";
        outputHashAlgo = "sha256";
        outputHashMode = "recursive";
      };
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = nixpkgs.legacyPackages.${system};
          deno = pkgs.deno;
          src = ./.;

          # Ship `deno run --cached-only` from a store path. The wrapper seeds a
          # writable user cache and runs the source with permissions needed for
          # env, subprocess (`herdr`), and Deno cache read/write (-A).
          herdr-mcp = pkgs.stdenv.mkDerivation {
            pname = "herdr-mcp";
            version = "0.2.0";
            inherit src;
            nativeBuildInputs = [ deno ];
            installPhase = ''
              mkdir -p $out/bin $out/lib
              cp -r ${denoCache} $out/lib/deno-cache
              cp -r src $out/lib/src
              cp deno.json deno.lock $out/lib/
              cat > $out/bin/herdr-mcp <<EOF
              #!${pkgs.stdenv.shell}
              # DENO_DIR must be writable (Deno writes a V8 code cache there).
              CACHE_DIR="\$HOME/.cache/herdr-mcp"
              if [ -n "\$XDG_CACHE_HOME" ]; then
                CACHE_DIR="\$XDG_CACHE_HOME/herdr-mcp"
              fi
              mkdir -p "\$CACHE_DIR"
              if [ ! -e "\$CACHE_DIR/.seeded" ]; then
                cp -r $out/lib/deno-cache/. "\$CACHE_DIR/" 2>/dev/null || true
                touch "\$CACHE_DIR/.seeded"
              fi
              export DENO_DIR="\$CACHE_DIR"
              exec ${deno}/bin/deno run --cached-only -A \
                $out/lib/src/main.ts "\$@"
              EOF
              chmod +x $out/bin/herdr-mcp
            '';
          };
        in
        {
          herdr-mcp = herdr-mcp;
          default = herdr-mcp;
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
