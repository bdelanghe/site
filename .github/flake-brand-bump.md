flake: bump the brand pin to match the npm package

The hermetic build composes dist/ — signed, attested and served — against
flake.lock's brand, while `npm ci` composes node_modules against the registry
tarball. brand-parity found the two disagreeing on token bytes, which is silent
by construction: both builds succeed and every other gate stays green, because
the token gates read node_modules while dist/ comes from Nix.

Opened by the brand-parity workflow, which has the nix that closes the gap
described in #274 until the second pin is retired outright.
