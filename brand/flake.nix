{
  description = "Bounded Systems brand — design tokens, fonts, the mark, and ready-to-link CSS, as a hermetic package.";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs = { self, nixpkgs }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = f: nixpkgs.lib.genAttrs systems (system: f nixpkgs.legacyPackages.${system});

      # The web payload: the curated, ready-to-link surface. Mirrors package.json
      # "files" — assets + the generated tokens.css. (dist/ Style-Dictionary
      # outputs and tools/ are intentionally excluded; this is the web artifact.)
      brand = pkgs: pkgs.stdenvNoCC.mkDerivation {
        pname = "bounded-systems-brand";
        version = "1.1.0";
        src = ./.;
        nativeBuildInputs = [ pkgs.nodejs_22 ];

        # build-tokens.mjs is dependency-free (node: builtins only), so the build
        # is fully offline. --check fails the build if the committed tokens.css
        # has drifted from tokens.json — the same drift gate, enforced hermetically.
        buildPhase = ''
          runHook preBuild
          node tokens/build-tokens.mjs --check
          runHook postBuild
        '';

        installPhase = ''
          runHook preInstall
          mkdir -p $out
          cp -r css tokens/tokens.css tokens/tokens.json mark avatar lockup favicon-32.png README.md $out/
          runHook postInstall
        '';
      };
    in
    {
      # Consumers (e.g. the site flake) pin this by flake.lock hash and copy
      # `${inputs.brand.packages.${system}.default}` into their served tree —
      # one pin, the built artifact, still hermetic.
      packages = forAll (pkgs: rec {
        default = brand pkgs;
        brand = default;
      });

      # `nix flake check` runs the token drift gate.
      checks = forAll (pkgs: { tokens = brand pkgs; });

      devShells = forAll (pkgs: {
        default = pkgs.mkShell { packages = [ pkgs.nodejs_22 ]; };
      });
    };
}
