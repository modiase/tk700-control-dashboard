{
  description = "TK700 Controller Dashboard";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    flake-utils.url = "github:numtide/flake-utils";
  };

  outputs =
    {
      self,
      nixpkgs,
      flake-utils,
    }:
    flake-utils.lib.eachDefaultSystem (
      system:
      let
        pkgs = nixpkgs.legacyPackages.${system};

        nodejs = pkgs.nodejs_20;
        pnpm = pkgs.pnpm;
        bun = pkgs.bun;

        pnpmDeps = pnpm.fetchDeps {
          pname = "tk700-controller-dashboard-server";
          version = "0.1.0";
          src = ./.;
          hash = "sha256-K3/tWUEmcTOdpFzSdcA4qh6JL/rWELBxq4vEJgN/r/c=";
          fetcherVersion = 2;
        };

        server = pkgs.stdenv.mkDerivation rec {
          pname = "tk700-controller-dashboard-server";
          version = "0.1.0";
          src = ./.;

          basePath = "/";

          nativeBuildInputs = [
            nodejs
            pnpm.configHook
            bun
          ];

          inherit pnpmDeps;

          buildPhase = ''
            runHook preBuild
            export HOME=$TMPDIR

            export BASE_PATH="${basePath}"
            ${pnpm}/bin/pnpm run build

            ${bun}/bin/bun build src/index.ts \
              --target=bun \
              --outfile=server.js \
              --minify

            runHook postBuild
          '';

          installPhase = ''
                        runHook preInstall

                        mkdir -p $out/lib/benq-control
                        cp -r dist $out/lib/benq-control/
                        cp server.js $out/lib/benq-control/

                        mkdir -p $out/bin
                        cat > $out/bin/tk700-controller-dashboard-server <<EOF
            #!/bin/sh
            cd $out/lib/benq-control
            exec ${bun}/bin/bun run server.js
            EOF
                        chmod +x $out/bin/tk700-controller-dashboard-server

                        runHook postInstall
          '';

          meta = {
            description = "Web-based controller dashboard for BenQ TK700 projector";
            mainProgram = "tk700-controller-dashboard-server";
          };
        };
      in
      {
        packages = {
          inherit server;
          default = server;
        };

        apps.default = {
          type = "app";
          program = "${server}/bin/tk700-controller-dashboard-server";
        };

        devShells.default = pkgs.mkShell {
          buildInputs = [
            pkgs.nodejs_20
            pkgs.pnpm
            bun
            pkgs.nodePackages.typescript-language-server
            pkgs.nodePackages.svelte-language-server
          ];
        };
      }
    );
}
