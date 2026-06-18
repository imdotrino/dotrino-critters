# `legs` del spec es una MÁSCARA de 6 bits: qué celdas (de las 6 posiciones) tienen pata.
# La POSICIÓN es genética (no derivada del seed), así coincide con el SVG por construcción y
# la fusión puede combinar posiciones. Aquí solo expandimos la máscara a celdas (fila, lado).
LEG_CELLS = [(0, -1), (0, 1), (1, -1), (1, 1), (2, -1), (2, 1)]


def cells_from_mask(mask):
    """Máscara de 6 bits -> [(fila, lado), ...] (celdas ocupadas, en orden 0..5)."""
    m = int(mask) & 63
    return [LEG_CELLS[c] for c in range(6) if m & (1 << c)]


def leg_count(mask):
    m = int(mask) & 63
    return bin(m).count("1")
