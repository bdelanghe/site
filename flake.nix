{
  description = "robertdelanghe.dev — software-engineering portfolio, built on @bdelanghe/brand";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";
    # THE SAME ARTIFACT npm INSTALLS — not a second copy of it.
    #
    # This was `github:bdelanghe/brand`, a source tree pinned by commit, while
    # package-lock.json pinned a registry tarball. Two pins for one dependency,
    # feeding two builds: `npm ci` -> node_modules -> the gates, and this ->
    # dist/ -> signed, attested, served. They could drift silently, because both
    # builds succeed and every gate stays green (the token gates read
    # node_modules; dist/ comes from Nix). See site#274.
    #
    # Pointing at the npm tarball makes that drift UNREPRESENTABLE rather than
    # checked: one artifact, two consumers, and flake.lock pins its narHash so
    # the bytes are fixed. It is also the artifact carrying brand's provenance
    # attestation, which the git tree never had.
    #
    # The version lives here, in the source, rather than buried in a lock — so
    # bumping brand means editing this line and running `nix flake update brand`,
    # and the version is directly comparable to package.json's range.
    brand = {
      url = "https://registry.npmjs.org/@bdelanghe/brand/-/brand-0.1.0.tgz";
      flake = false;
    };
  };

  outputs = { self, nixpkgs, brand }:
    let
      systems = [ "x86_64-linux" "aarch64-linux" "x86_64-darwin" "aarch64-darwin" ];
      forAll = nixpkgs.lib.genAttrs systems;
      pkgsFor = system: nixpkgs.legacyPackages.${system};
    in
    {
      packages = forAll (system:
        let pkgs = pkgsFor system; in
        rec {
          default = site;
          site = pkgs.stdenv.mkDerivation {
            pname = "robertdelanghe-dev";
            version = "0.1.0";
            src = ./.;
            nativeBuildInputs = [ pkgs.nodejs_22 ];
            buildPhase = ''
              runHook preBuild
              rm -rf brand
              # npm tarballs carry a single top-level `package/` directory. Nix's
              # tarball fetcher strips a lone top-level component when it unpacks,
              # so the store path may be either the tarball root or its contents —
              # handle both rather than depending on which.
              src=${brand}
              if [ -d "$src/package" ]; then src="$src/package"; fi
              cp -rL "$src" brand
              chmod -R u+w brand
              # `node brand/tokens/build-tokens.mjs --check` used to run here. That
              # script is not in brand's published `files`, and it should not be:
              # it re-verified the PUBLISHER's own generation step against what is
              # now an immutable artifact. brand's ci.yml gates it at the source,
              # which is the only place the check means anything.
              node build.mjs
              runHook postBuild
            '';
            installPhase = ''
              runHook preInstall
              cp -r dist $out
              runHook postInstall
            '';
          };
        });

      devShells = forAll (system:
        let pkgs = pkgsFor system; in
        {
          default = pkgs.mkShell {
            packages = [ pkgs.nodejs_22 pkgs.wrangler ];
          };
          # Deploy shell: adds cosign (keyless signing) + oras (push the built
          # site to GHCR as an OCI artifact). Used by .github/workflows/deploy.yml.
          # Pinned here via flake.lock alongside wrangler — the deploy toolchain
          # stays reproducible, no unpinned `nix run nixpkgs#…`.
          deploy = pkgs.mkShell {
            packages = [ pkgs.nodejs_22 pkgs.wrangler pkgs.cosign pkgs.oras ];
          };
        });
    };
}
