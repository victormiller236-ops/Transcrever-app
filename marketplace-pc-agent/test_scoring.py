from scoring import analyze, parse_price


def test_price():
    assert parse_price("R$ 2.500") == 2500.0
    assert parse_price("R$1.999,90") == 1999.9


def test_good_pc():
    a = analyze("PC Gamer Ryzen 5 5600, RTX 3060 12gb, 16GB RAM DDR4, SSD NVMe 500gb", 2900)
    assert a.gpu == "RTX 3060" and a.cpu == "Ryzen 5 5600" and a.ram_gb == 16 and a.ssd
    assert not a.flags


def test_ti_before_base():
    assert analyze("rtx 3060 ti", 2900).gpu == "RTX 3060 Ti"


def test_flags():
    a = analyze("Só o gabinete, pix antecipado", 500)
    assert len(a.flags) >= 3
