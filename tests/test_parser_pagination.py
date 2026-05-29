"""Parser 分页与 JS 对象解析单元测试"""
import unittest

from sources.hcomic import HComicParser


class TestParserPagination(unittest.TestCase):
    """测试分页信息解析"""

    def test_parse_pagination_info_maps_fields_correctly(self):
        """`pages` 应映射为总页数，`total` 应映射为总条目数"""
        data = {
            "pages": {
                "pages": 6,
                "total": 55,
                "limit": 10,
            }
        }

        pagination = HComicParser._parse_pagination_info(data, requested_page=3)

        self.assertIsNotNone(pagination)
        self.assertEqual(pagination.current_page, 3)
        self.assertEqual(pagination.total_pages, 6)
        self.assertEqual(pagination.total_items, 55)
        self.assertEqual(pagination.limit, 10)

    def test_parse_pagination_info_clamps_out_of_range_page(self):
        """请求页码超出范围时应被限制在有效页区间"""
        data = {
            "pages": {
                "pages": 6,
                "total": 55,
                "limit": 10,
            }
        }

        pagination = HComicParser._parse_pagination_info(data, requested_page=99)

        self.assertIsNotNone(pagination)
        self.assertEqual(pagination.current_page, 6)


class TestJsObjectParsing(unittest.TestCase):
    """测试 JS 对象转 JSON 逻辑"""

    def test_jsobj_to_dict_keeps_colon_inside_string(self):
        """字符串里的 `super:nova` 不应被错误当成 key:value"""
        js_obj_text = r'''{data:{title:{english:"[HEATWAVE, super:nova] test"}, pages:{pages:1,total:1,limit:10}}}'''

        data = HComicParser._jsobj_to_dict(js_obj_text)

        self.assertEqual(data["data"]["title"]["english"], "[HEATWAVE, super:nova] test")
        self.assertEqual(data["data"]["pages"]["pages"], 1)


if __name__ == "__main__":
    unittest.main()
