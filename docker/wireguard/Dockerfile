FROM ghcr.io/groupsky/homy/wireguard:1.0.20260223-r0-ls117

# The linuxserver conf generator has two places that assume peer names are
# plain alphanumeric. Our peers use hyphens (geno-laptop, tania-phone, ...), so
# both must be patched or every generate_confs run (triggered by any PEERS
# change) leaves wg0.conf broken.
#
# 1. The peer-name guard only writes a [Peer] block for names matching
#    ^[[:alnum:]]+$, silently skipping any name containing '-' or '_' (#1379).
# 2. The per-peer AllowedIPs override builds a shell variable name out of the
#    peer name -- SERVER_ALLOWEDIPS=SERVER_ALLOWEDIPS_PEER_${i} -- and reads it
#    back by indirect expansion. Shell variable names cannot contain '-', so
#    with (1) relaxed the expansion fails with "invalid variable name" and
#    aborts the generator midway through the first hyphenated peer's block,
#    truncating wg0.conf between PublicKey and AllowedIPs and dropping every
#    peer off the tunnel (#1553). Substituting '_' for '-' in the constructed
#    name is the only shape that can work: the override is otherwise unnameable
#    as an environment variable.
#
# The grep assertions fail the build if a future base-image bump moves, removes
# or duplicates either patch. Both are asserted, positively and negatively:
# #1379 asserted only the guard, which is how (2) slipped past for eight weeks.
# The negative assertions are fixed-string searches for the *unpatched* shapes,
# so a base image that reintroduces one anywhere in the script fails the build.
RUN CONF_RUN=/etc/s6-overlay/s6-rc.d/init-wireguard-confs/run \
    && sed -i 's/alnum:]]+/alnum:]_-]+/' "$CONF_RUN" \
    && sed -i 's/SERVER_ALLOWEDIPS_PEER_${i}/SERVER_ALLOWEDIPS_PEER_${i\/\/-\/_}/' "$CONF_RUN" \
    && grep -qF 'alnum:]_-]+' "$CONF_RUN" \
    && ! grep -qF '[[:alnum:]]+$' "$CONF_RUN" \
    && grep -qF 'SERVER_ALLOWEDIPS=SERVER_ALLOWEDIPS_PEER_${i//-/_}' "$CONF_RUN" \
    && ! grep -qF 'SERVER_ALLOWEDIPS_PEER_${i}' "$CONF_RUN"
