def bubble_sort(arr):
    """
    冒泡排序算法
    时间复杂度：O(n²)
    空间复杂度：O(1)

    参数:
        arr: 待排序的列表

    返回:
        排序后的列表
    """
    n = len(arr)
    for i in range(n):
        swapped = False
        for j in range(0, n - i - 1):
            if arr[j] > arr[j + 1]:
                arr[j], arr[j + 1] = arr[j + 1], arr[j]
                swapped = True
        if not swapped:
            break
    return arr


def main():
    """演示冒泡排序"""
    test_data = [
        [64, 34, 25, 12, 22, 11, 90],
        [5, 1, 4, 2, 8],
        [3, 0, -1, 5, 2, -3],
        [1, 2, 3, 4, 5],   # 已经有序
        [9, 8, 7, 6, 5],   # 完全逆序
    ]

    for i, data in enumerate(test_data, 1):
        original = data.copy()
        sorted_data = bubble_sort(data)
        print(f"测试 #{i}: {original} -> {sorted_data}")


if __name__ == "__main__":
    main()
