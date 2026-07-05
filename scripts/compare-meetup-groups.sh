#!/usr/bin/env bash

set -euo pipefail

HTML_FILE="meetup-groups.html"
GROUPS_FILE="groups.yml"
TMP_DIR=""

usage() {
  cat <<'EOF'
Usage:
  scripts/compare-meetup-groups.sh --html meetup-groups.html --groups groups.yml

Options:
  --html    Path to exported Meetup groups HTML file
  --groups  Path to groups.yml
  --help    Show this help message

Examples:
  scripts/compare-meetup-groups.sh --html meetup-groups.html --groups groups.yml
  scripts/compare-meetup-groups.sh --html downloads/groups.html
EOF
}

cleanup() {
  if [[ -n "${TMP_DIR}" && -d "${TMP_DIR}" ]]; then
    rm -rf "${TMP_DIR}"
  fi
}

die() {
  echo "ERROR: $*" >&2
  exit 1
}

parse_args() {
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --html)
        [[ $# -ge 2 ]] || die "Missing value for --html"
        HTML_FILE="$2"
        shift 2
        ;;
      --groups)
        [[ $# -ge 2 ]] || die "Missing value for --groups"
        GROUPS_FILE="$2"
        shift 2
        ;;
      --help|-h)
        usage
        exit 0
        ;;
      *)
        die "Unknown argument: $1"
        ;;
    esac
  done
}

check_dependencies() {
  command -v grep >/dev/null 2>&1 || die "grep is required"
  command -v sed >/dev/null 2>&1 || die "sed is required"
  command -v sort >/dev/null 2>&1 || die "sort is required"
  command -v comm >/dev/null 2>&1 || die "comm is required"
}

normalise_meetup_urls() {
  sed -E \
    -e 's#^http://#https://#' \
    -e 's#https://meetup\.com/#https://www.meetup.com/#' \
    -e 's#([?&].*)$##' \
    -e 's#(/events/.*)$#/#' \
    -e 's#(/members/.*)$#/#' \
    -e 's#(/photos/.*)$#/#' \
    -e 's#(/about/.*)$#/#' \
    -e 's#(/calendar/.*)$#/#' \
    -e 's#(/discussion/.*)$#/#' \
    -e 's#(/)$#/#' \
    -e 's#(https://www\.meetup\.com/[^/]+).*$#\1/#' |
    grep -E '^https://www\.meetup\.com/[^/]+/$' |
    grep -Ev '^https://www\.meetup\.com/(groups|find|topics|apps|events|account|login|logout)/$' |
    sort -u
}

extract_urls_from_html() {
  local html_file="$1"

  grep -Eo 'https?://([^"'"'"' <>]+)?meetup\.com/[^"'"'"' <>]+' "${html_file}" |
    normalise_meetup_urls
}

extract_urls_from_groups_yml() {
  local groups_file="$1"

  grep -Eo 'https?://([^"'"'"' <>]+)?meetup\.com/[^"'"'"' <>]+' "${groups_file}" |
    normalise_meetup_urls
}

print_section() {
  local title="$1"
  local file="$2"

  echo
  echo "${title}"
  printf '%*s\n' "${#title}" '' | tr ' ' '-'

  if [[ ! -s "${file}" ]]; then
    echo "None"
    return
  fi

  sed 's/^/- /' "${file}"
}

main() {
  parse_args "$@"
  check_dependencies

  [[ -f "${HTML_FILE}" ]] || die "HTML file not found: ${HTML_FILE}"
  [[ -f "${GROUPS_FILE}" ]] || die "Groups file not found: ${GROUPS_FILE}"

  TMP_DIR="$(mktemp -d)"
  trap cleanup EXIT

  local html_urls="${TMP_DIR}/html-urls.txt"
  local groups_urls="${TMP_DIR}/groups-urls.txt"
  local present_urls="${TMP_DIR}/present-urls.txt"
  local missing_urls="${TMP_DIR}/missing-urls.txt"
  local config_only_urls="${TMP_DIR}/config-only-urls.txt"

  extract_urls_from_html "${HTML_FILE}" > "${html_urls}"
  extract_urls_from_groups_yml "${GROUPS_FILE}" > "${groups_urls}"

  comm -12 "${html_urls}" "${groups_urls}" > "${present_urls}"
  comm -23 "${html_urls}" "${groups_urls}" > "${missing_urls}"
  comm -13 "${html_urls}" "${groups_urls}" > "${config_only_urls}"

  echo
  echo "Meetup group comparison"
  echo "======================="
  echo "HTML file:     $(cd "$(dirname "${HTML_FILE}")" && pwd)/$(basename "${HTML_FILE}")"
  echo "Groups file:   $(cd "$(dirname "${GROUPS_FILE}")" && pwd)/$(basename "${GROUPS_FILE}")"
  echo "HTML groups:   $(wc -l < "${html_urls}" | tr -d ' ')"
  echo "Configured:    $(wc -l < "${groups_urls}" | tr -d ' ')"
  echo "Present:       $(wc -l < "${present_urls}" | tr -d ' ')"
  echo "Absent:        $(wc -l < "${missing_urls}" | tr -d ' ')"
  echo "Config-only:   $(wc -l < "${config_only_urls}" | tr -d ' ')"

  print_section "Present in groups.yml" "${present_urls}"
  print_section "Missing from groups.yml" "${missing_urls}"
  print_section "In groups.yml but not found in exported HTML" "${config_only_urls}"

  if [[ -s "${missing_urls}" ]]; then
    echo
    echo "Suggested YAML additions"
    echo "------------------------"
    sed 's/^/  - /' "${missing_urls}"
  fi
}

main "$@"