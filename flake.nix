{
  description = "Entorno de desarrollo para Árbol (frontend, Hackatón EdTech FCEIA-UNR)";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs = { self, nixpkgs, flake-utils, ... }:
    flake-utils.lib.eachDefaultSystem (system:
      let
        pkgs = import nixpkgs {
          inherit system;
          config.allowUnfree = true;
        };
      in {
        devShells.default = pkgs.mkShell {
          buildInputs = with pkgs; [
            git
            nodejs_22 # trae npm y npx
            pnpm
          ];

          shellHook = ''
            echo "Entorno Árbol (frontend)"
            echo "  node $(node --version) · npm $(npm --version) · pnpm $(pnpm --version)"
            echo ""
            echo "Primera vez:"
            echo "  pnpm install"
            echo ""
            echo "Para correr:"
            echo "  pnpm dev"
          '';
        };
      });
}
