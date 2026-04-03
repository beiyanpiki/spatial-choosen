from dataclasses import dataclass
from enum import Enum
from typing import Tuple
import numpy as np


CANNY_THRESHOLDS = (50, 150)
LINE_EXTENSION_MULTIPLIER = 100
EDGE_LENGTH_TOLERANCE = 200
INTERSECTION_CLUSTER_DISTANCE = 50
HOUGH_PARAMS = {
    "rho": 1,
    "theta": np.pi / 180,
    "threshold": 150,
    "minLineLength": 200,
    "maxLineGap": 20,
}
RADIAN_TOLERANCE = np.deg2rad(1)


class ColorChannel(Enum):
    HUE = "hue"
    SATURATION = "saturation"
    VALUE = "value"


@dataclass
class ProcessingParams:
    """Configuration parameters for image processing.
    For 64x64, the params can be set as follows in the code,
    For 96x96, grid_size should be set to 96, and gap_ratio should be set to 25/15.
    """

    scale_factor: float = 2.0
    grid_size: Tuple[int, int] = (64, 64)
    gap_ratio: float = 1.0
    dbscan_eps: int = 2
    dbscan_min_samples: int = 10
    activation_threshold: float = 0.1
    block_threshold: int = 135
    type: str = 'square' # 'square' or 'dy' or 's3000'


__all__ = [
    "CANNY_THRESHOLDS",
    "LINE_EXTENSION_MULTIPLIER",
    "EDGE_LENGTH_TOLERANCE",
    "INTERSECTION_CLUSTER_DISTANCE",
    "HOUGH_PARAMS",
    "RADIAN_TOLERANCE",
    "ProcessingParams",
]
