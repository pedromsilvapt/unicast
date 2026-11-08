.PHONY: patch minor major retag

patch minor major retag:
	@./scripts/bump.sh $@
