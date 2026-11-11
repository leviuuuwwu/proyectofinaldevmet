#!/usr/bin/env bash
# Imprime DATABASE_URL para la app con la contraseña codificada para URL (RFC 3986).
# Las contraseñas de `openssl rand -base64` contienen / + =; sin codificar, la URL es
# inválida y api, indexer y migración fallan con "Invalid URL".
# Lee la contraseña de PG_PASSWORD (no de argumentos: no aparece en `ps`).
set -euo pipefail
: "${PG_PASSWORD:?PG_PASSWORD vacío}"

encoded=""
for ((i = 0; i < ${#PG_PASSWORD}; i++)); do
	c="${PG_PASSWORD:i:1}"
	case "$c" in
	[a-zA-Z0-9.~_-]) encoded+="$c" ;;
	*) printf -v hex '%%%02X' "'$c" && encoded+="$hex" ;;
	esac
done

printf 'postgres://search:%s@postgres:5432/search' "$encoded"
