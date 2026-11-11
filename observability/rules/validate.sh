#!/usr/bin/env bash
# Valida las reglas con promtool (check + pruebas unitarias) sin instalar nada: usa la imagen
# oficial de Prometheus fijada por digest (v3.5.0). Requiere Docker.
#
#   bash observability/rules/validate.sh
set -euo pipefail

IMAGE="prom/prometheus@sha256:63805ebb8d2b3920190daf1cb14a60871b16fd38bed42b857a3182bc621f4996"

cd "$(dirname "$0")"
work=".validate-tmp"
rm -rf "$work" && mkdir "$work"
trap 'rm -rf "$work"' EXIT

# promtool lee reglas planas; el PrometheusRule las trae bajo `spec:` (se quita ese nivel).
for f in *.yaml; do
  sed -n '/^spec:/,$p' "$f" | tail -n +2 | sed 's/^  //' >"$work/${f%.yaml}.rules.yaml"
done
cp tests/*.yaml "$work/"

# MSYS_NO_PATHCONV evita que Git Bash en Windows reescriba las rutas del contenedor.
run() { MSYS_NO_PATHCONV=1 docker run --rm -v "$PWD/$work:/work" -w /work --entrypoint promtool "$IMAGE" "$@"; }

rules="$(cd "$work" && ls ./*.rules.yaml)"
tests="$(cd "$work" && ls ./*.test.yaml)"

echo "== promtool check rules"
# shellcheck disable=SC2086
run check rules $rules
echo "== promtool test rules"
# shellcheck disable=SC2086
run test rules $tests
