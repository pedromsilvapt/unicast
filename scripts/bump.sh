#!/usr/bin/env bash
# Bump or retag the version, commit it (bump only), tag it, and optionally push.
#
# Usage: ./scripts/bump.sh patch|minor|major|retag [PUSH=0]
#
# VERSION (repo root) is the source of truth for the current version, stored
# as bare `x.y.z` (no `v`).
#
#   patch|minor|major  Read VERSION, increment the requested component (zeroing
#                      the lower ones), write it back, update every file that
#                      carries the version, commit ONLY those files as
#                      "chore: bump version to X.Y.Z", and tag that commit as
#                      vX.Y.Z.
#   retag              Read VERSION, re-point the existing vX.Y.Z tag at HEAD
#                      without bumping or committing. Uses -f on git tag and
#                      git push so an already-published tag moves in place;
#                      intended for fixing a botched release off the current
#                      commit. Pinned consumers will see the tag move.
#
# The release workflow in .github/workflows/release.yml triggers on the pushed
# v* tag and builds the Docker image tagged X.Y.Z, pinning unicast-interface
# to the same vX.Y.Z tag.
#
# Push policy: by default the branch and the tag are pushed. Set PUSH=0 to
# skip pushing and instead print the commands to copy/paste.
#
# Working-tree policy: only VERSION and the version-bearing files are staged
# and committed (bump only). Other modified or untracked files are left
# untouched in the working tree.
#
# If VERSION is missing, it is treated as 0.0.0 so the first bump bootstraps it.

set -euo pipefail

usage() {
	echo "usage: $0 patch|minor|major|retag [PUSH=0|1]" >&2
	exit 1
}

[ $# -ge 1 ] && [ $# -le 2 ] || usage
action="$1"
case "$action" in
	patch|minor|major|retag) ;;
	*) usage ;;
esac

push="${2:-${PUSH:-1}}"
push="${push#PUSH=}"
case "$push" in
	0|1) ;;
	*) echo "PUSH must be 0 or 1" >&2; exit 1 ;;
esac

# Resolve repo root so the script works from any cwd.
root=$(git rev-parse --show-toplevel)
cd "$root"

version_file="VERSION"

# Files that carry the version, besides VERSION itself.
json_files=(
	"package.json"
)
# package-lock.json carries the version twice in its header (top level and
# packages[""]); only lines before the first "dependencies" key are touched.
lock_files=(
	"package-lock.json"
)

# Update every file that carries the version and record the ones that exist in
# `updated_files`. Missing files are skipped with a warning so the script keeps
# working if a project is removed.
updated_files=()
update_version_files() {
	local new="$1"
	local f

	for f in "${json_files[@]}"; do
		if [ -f "$f" ]; then
			sed -i "0,/\"version\": \"[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\"/s//\"version\": \"${new}\"/" "$f"
			updated_files+=("$f")
		else
			echo "warning: ${f} not found; skipping" >&2
		fi
	done

	for f in "${lock_files[@]}"; do
		if [ -f "$f" ]; then
			sed -i "1,/\"dependencies\"/s/\"version\": \"[0-9][0-9]*\.[0-9][0-9]*\.[0-9][0-9]*\"/\"version\": \"${new}\"/" "$f"
			updated_files+=("$f")
		else
			echo "warning: ${f} not found; skipping" >&2
		fi
	done
}

if [ -f "$version_file" ]; then
	cur=$(tr -d '[:space:]' < "$version_file")
else
	cur=""
fi
[ -n "$cur" ] || cur="0.0.0"

IFS=. read -r major minor patch <<<"$cur"
major=${major:-0}
minor=${minor:-0}
patch=${patch:-0}

if [ "$action" = "retag" ]; then
	new="${major}.${minor}.${patch}"
	tag="v${new}"
	force="-f"
else
	case "$action" in
		major) major=$((major + 1)); minor=0; patch=0 ;;
		minor) minor=$((minor + 1)); patch=0 ;;
		patch) patch=$((patch + 1)) ;;
	esac

	new="${major}.${minor}.${patch}"
	tag="v${new}"
	force=""

	if git rev-parse -q --verify "refs/tags/${tag}" >/dev/null; then
		echo "error: tag ${tag} already exists; use 'retag' to move it" >&2
		exit 1
	fi

	# Stage ONLY the VERSION file and the version-bearing files, leaving
	# other working-tree changes alone.
	printf '%s\n' "$new" > "$version_file"
	update_version_files "$new"

	git add "$version_file" "${updated_files[@]}"
	git commit -m "chore: bump version to ${new}" -- "$version_file" "${updated_files[@]}"
fi

git tag $force -a "$tag" -m "Release ${tag}" HEAD

echo "${action}: tagged ${tag} at $(git rev-parse --short HEAD)"

branch=$(git rev-parse --abbrev-ref HEAD)

if [ "$push" -eq 0 ]; then
	echo "To publish, run:" >&2
	[ "$action" = "retag" ] || echo "  git push" >&2
	echo "  git push ${force:+$force }origin ${tag}" >&2
	exit 0
fi

branch_pushed=0
if [ "$action" = "retag" ]; then
	branch_pushed=1
elif git rev-parse --abbrev-ref '@{upstream}' >/dev/null 2>&1; then
	git push
	branch_pushed=1
else
	echo "warning: branch '${branch}' has no upstream; not pushing the branch" >&2
fi

git push $force origin "$tag"

if [ "$branch_pushed" -eq 0 ]; then
	echo "Tag ${tag} pushed. To publish the branch, set upstream and push:" >&2
	echo "  git push -u origin ${branch}" >&2
fi
