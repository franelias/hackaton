package plan_test

import "sort"

func sorted(s []int) []int {
	out := append([]int(nil), s...)
	sort.Ints(out)
	return out
}

func sorted2(s []string) []string {
	out := append([]string(nil), s...)
	sort.Strings(out)
	return out
}
