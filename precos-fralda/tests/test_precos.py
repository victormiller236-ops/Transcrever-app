import unittest

from precos_fralda import texto, vtex


class TestTamanho(unittest.TestCase):
    def test_tamanhos_simples(self):
        casos = {
            "Fralda Pampers Confort Sec G 60 Unidades": "G",
            "Fralda Huggies Tripla Proteção Tam. XG c/ 52": "XG",
            "Fralda Turma da Mônica EG 40 un": "XG",
            "Fralda Pampers Premium Care RN 36 Unidades": "RN",
            "Fralda MamyPoko XXG com 48": "XXG",
        }
        for nome, esperado in casos.items():
            self.assertEqual(texto.extrair_tamanho(nome), esperado, nome)

    def test_ambiguo_vira_none(self):
        self.assertIsNone(texto.extrair_tamanho("Fralda Pampers M/G 60 unidades"))
        self.assertIsNone(texto.extrair_tamanho("Fralda Pampers G e XG 60 unidades"))
        self.assertIsNone(texto.extrair_tamanho("Fralda Pampers Confort Sec 60 unidades"))

    def test_recem_nascido_e_rn_plus(self):
        self.assertEqual(texto.extrair_tamanho("Fralda Pampers Premium Care Recém-Nascido 36 un"), "RN")
        self.assertEqual(texto.extrair_tamanho("Fralda Mili Love & Care Recém Nascido c/ 20"), "RN")
        self.assertEqual(texto.extrair_tamanho("Fralda Pampers Premium Care RN+ 34 unidades"), "RN+")
        self.assertEqual(texto.extrair_tamanho("Fralda Pampers Premium Care RN Plus 34 unidades"), "RN+")
        self.assertEqual(texto.extrair_tamanho("Fralda Pampers Recém-Nascido Premium Care RN+ 36 Unidades"), "RN+")
        self.assertEqual(texto.extrair_tamanho("Fralda Pampers Recem Nascido Tamanho Rn+ 36 Unidades"), "RN+")
        self.assertIsNone(texto.extrair_tamanho("Fralda Mili RN/P 20 unidades"))

    def test_gramas_nao_e_tamanho(self):
        self.assertIsNone(texto.extrair_tamanho("Pomada 45g"))


class TestQuantidade(unittest.TestCase):
    def test_formatos(self):
        casos = {
            "Fralda Pampers Confort Sec G 60 Unidades": 60,
            "Fralda Huggies Tripla Proteção XG c/ 52": 52,
            "Fralda MamyPoko G com 48": 48,
            "Fralda Pampers G 80un": 80,
            "Fralda Pampers Confort Sec G Leve 80 Pague 70 Unidades": 80,
        }
        for nome, esperado in casos.items():
            self.assertEqual(texto.extrair_quantidade(nome), esperado, nome)

    def test_kits_e_conflitos_viram_none(self):
        self.assertIsNone(texto.extrair_quantidade("Kit 2 Fraldas Pampers G 60 unidades"))
        self.assertIsNone(texto.extrair_quantidade("Fralda Pampers G 2x 60 unidades"))
        self.assertIsNone(texto.extrair_quantidade("Fralda Pampers G 60 unidades c/ 64"))
        self.assertIsNone(texto.extrair_quantidade("Fralda Pampers G"))


class TestCorresponde(unittest.TestCase):
    def test_termos_e_exclusao(self):
        self.assertTrue(texto.corresponde("Fralda Huggies Tripla Proteção G", ["huggies", "tripla protecao"], []))
        self.assertFalse(texto.corresponde("Fralda Huggies Supreme Care G", ["huggies", "tripla protecao"], []))
        self.assertFalse(texto.corresponde("Lenço Umedecido Huggies", ["huggies"], ["lenco"]))

    def test_termo_e_palavra_inteira(self):
        self.assertTrue(texto.corresponde("Fralda Mili Love & Care G 64 un", ["mili"], []))
        self.assertFalse(texto.corresponde("Fralda Família Econômica G 64 un", ["mili"], []))

    def test_exclusao_por_inicio_de_palavra(self):
        self.assertFalse(texto.corresponde("Fralda Geriátrica Mili G 8 un", ["mili"], ["geriatric"]))


class TestVtex(unittest.TestCase):
    CATALOGO = [
        {
            "productId": "10",
            "productName": "Fralda Pampers Confort Sec G 60 Unidades",
            "link": "https://loja/fralda/p",
            "items": [
                {
                    "itemId": "100",
                    "nameComplete": "Fralda Pampers Confort Sec G 60 Unidades",
                    "sellers": [
                        {"sellerId": "1", "sellerName": "Loja",
                         "commertialOffer": {"Price": 89.9, "ListPrice": 119.9, "AvailableQuantity": 50}},
                        {"sellerId": "mkt", "sellerName": "Parceiro",
                         "commertialOffer": {"Price": 0, "ListPrice": 0, "AvailableQuantity": 0}},
                    ],
                }
            ],
        }
    ]

    def test_url_de_busca(self):
        self.assertEqual(
            vtex.url_busca("www.loja.com.br", "fralda pampers", 20),
            "https://www.loja.com.br/api/catalog_system/pub/products/search?ft=fralda%20pampers&_from=20&_to=29",
        )

    def test_ofertas_ignoram_indisponiveis(self):
        ofertas = vtex.ofertas_do_catalogo("Loja", self.CATALOGO)
        self.assertEqual(len(ofertas), 1)
        self.assertEqual(ofertas[0].preco, 89.9)
        self.assertEqual(ofertas[0].sku_id, "100")

    def test_simulacao(self):
        self.assertEqual(
            vtex.preco_da_simulacao({"items": [{"sellingPrice": 8490, "price": 8990, "availability": "available"}]}),
            84.9,
        )
        self.assertIsNone(vtex.preco_da_simulacao({"items": [{"sellingPrice": 8490, "availability": "withoutStock"}]}))
        self.assertIsNone(vtex.preco_da_simulacao({"items": []}))

    def test_preco_confirmado_tem_prioridade(self):
        oferta = vtex.ofertas_do_catalogo("Loja", self.CATALOGO)[0]
        oferta.preco_confirmado = 84.9
        self.assertEqual(oferta.preco, 84.9)


if __name__ == "__main__":
    unittest.main()
