from typing import List, NamedTuple

import numpy as np
from cv2.typing import MatLike
from sklearn.cluster import DBSCAN

# Constants
from .constant import (
    INTERSECTION_CLUSTER_DISTANCE,
    RADIAN_TOLERANCE,
)


class Point(NamedTuple):
    x: int
    y: int


def check_angle_orientation(angle: float, tolerance: float = RADIAN_TOLERANCE) -> int:
    """Determine if an angle represents a horizontal or vertical orientation.

    Args:
        angle (float): The angle in radians to be checked.
        tolerance (float, optional): The tolerance range in radians for angle comparison.
            Defaults to RADIAN_TOLERANCE.

    Returns:
        int: Orientation indicator:
            0: Neither horizontal nor vertical
            1: Horizontal orientation (0°, 180°)
            2: Vertical orientation (90°, 270°)
    """
    legal_angles = np.array(
        [
            [2 * np.pi - tolerance, 2 * np.pi],
            [0, tolerance],
            [np.pi - tolerance, np.pi + tolerance],
            [np.pi / 2 - tolerance, np.pi / 2 + tolerance],
            [3 * np.pi / 2 - tolerance, 3 * np.pi / 2 + tolerance],
        ]
    )

    normalized_angle = angle + 2 * np.pi if angle < 0 else angle

    for i, (lower, upper) in enumerate(legal_angles):
        if lower <= normalized_angle <= upper:
            return 1 if i <= 2 else 2
    return 0


def get_valid_lines(lines: List[MatLike], tolerance: float) -> List[MatLike]:
    """Filter and extract horizontal and vertical lines from a set of lines.

    Args:
        lines (List[MatLike]): List of line segments, where each line is represented
            as [[x1, y1, x2, y2]].
        tolerance (float): The tolerance range in radians for angle comparison.

    Returns:
        List[MatLike]: Filtered list containing only horizontal and vertical lines.
    """
    return [
        line
        for line in lines
        if check_angle_orientation(
            np.arctan2(
                np.abs(line[0][3] - line[0][1]), np.abs(line[0][2] - line[0][0])
            ),
            tolerance,
        )
        != 0
    ]


def extend_line_segments(lines: List[MatLike], extension_factor: int) -> List[MatLike]:
    """Extend line segments by a given factor while maintaining their direction.

    Args:
        lines (List[MatLike]): List of line segments, where each line is represented
            as [[x1, y1, x2, y2]].
        extension_factor (int): Factor by which to extend the lines. A factor of 2
            doubles the line length.

    Returns:
        List[MatLike]: List of extended line segments in the same format as input.
    """
    extended = []
    for line in lines:
        x1, y1, x2, y2 = line[0]
        length = np.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
        direction = np.array([x2 - x1, y2 - y1]) / length

        extension = length * (extension_factor - 1) / 2
        new_x1 = int(x1 - direction[0] * extension)
        new_y1 = int(y1 - direction[1] * extension)
        new_x2 = int(x2 + direction[0] * extension)
        new_y2 = int(y2 + direction[1] * extension)

        extended.append([[new_x1, new_y1, new_x2, new_y2]])
    return extended


def compute_line_intersections(lines: List[MatLike], tolerance: float) -> List[Point]:
    """Compute intersection points between pairs of perpendicular lines.

    Args:
        lines (List[MatLike]): List of line segments, where each line is represented
            as [[x1, y1, x2, y2]].
        tolerance (float): The tolerance range in radians for determining perpendicular lines.

    Returns:
        List[Point]: List of intersection points between perpendicular lines.

    Note:
        Only considers intersections between lines that are perpendicular to each other
        within the given tolerance.
    """
    intersections = []
    for i, line1 in enumerate(lines):
        for line2 in lines[i + 1 :]:
            x1, y1, x2, y2 = line1[0]
            x3, y3, x4, y4 = line2[0]

            angle1 = np.arctan2(y2 - y1, x2 - x1)
            angle2 = np.arctan2(y4 - y3, x4 - x3)

            if check_angle_orientation(angle1, tolerance) ^ check_angle_orientation(
                angle2, tolerance
            ):
                denominator = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
                px = (
                    (x1 * y2 - y1 * x2) * (x3 - x4) - (x1 - x2) * (x3 * y4 - y3 * x4)
                ) / denominator
                py = (
                    (x1 * y2 - y1 * x2) * (y3 - y4) - (y1 - y2) * (x3 * y4 - y3 * x4)
                ) / denominator
                intersections.append(Point(int(px), int(py)))
    return intersections


def group_intersection_points(points: List[Point]) -> List[MatLike]:
    """Group nearby intersection points using DBSCAN clustering algorithm.

    Args:
        points (List[Point]): List of intersection points to be clustered.

    Returns:
        List[MatLike]: List of cluster centroids, where each centroid represents
            the mean position of a group of nearby points.

    Note:
        Uses DBSCAN clustering with eps=INTERSECTION_CLUSTER_DISTANCE and min_samples=1.
        Points marked as noise (-1) by DBSCAN are excluded from the result.
    """
    if not points:
        return []

    clusterer = DBSCAN(eps=INTERSECTION_CLUSTER_DISTANCE, min_samples=1)
    labels = clusterer.fit_predict(points)

    centroids = []
    for label in set(labels) - {-1}:
        cluster_points = np.array([p for p, l in zip(points, labels) if l == label])
        centroids.append(np.mean(cluster_points, axis=0))
    return centroids


def check_rectangle_validity(points: MatLike, tolerance: float) -> bool:
    """Verify if a set of points forms a valid rectangle by checking corner angles.

    Args:
        points (MatLike): Array of 4 points representing potential rectangle corners.
        tolerance (float): The tolerance range in radians for angle comparison.

    Returns:
        bool: True if points form a valid rectangle (all angles ~90°), False otherwise.

    Note:
        A valid rectangle must have exactly 4 points and all internal angles must be
        approximately 90 degrees within the given tolerance.
    """
    if len(points) != 4:
        return False

    for i in range(len(points)):
        prev_point = points[i - 1]
        curr_point = points[i]
        next_point = points[(i + 1) % len(points)]

        vector1 = prev_point - curr_point
        vector2 = next_point - curr_point

        cos_angle = np.dot(vector1, vector2) / (
            np.linalg.norm(vector1) * np.linalg.norm(vector2)
        )
        angle = np.arccos(np.clip(cos_angle, -1.0, 1.0))

        if not check_angle_orientation(angle, tolerance):
            return False

    return True


__all__ = [
    "get_valid_lines",
    "extend_line_segments",
    "compute_line_intersections",
    "group_intersection_points",
    "check_rectangle_validity",
]
