from dataclasses import dataclass

GROUPS = ("Fund", "Trading", "Research", "Risk", "Operations")


@dataclass(frozen=True)
class Page:
    route: str
    label: str
    icon: str
    category: str
    template: str
    access: str = "public"
    styles: tuple = ()
    scripts: tuple = ()
    body_class: str = "record"


PAGES = (
    Page("/", "About us", "overview", "Fund", "about", styles=("about.css",),
         scripts=("gaussian.js",), body_class="about"),
    Page("/predictions/", "Track record", "trend", "Fund", "record",
         styles=("style.css", "paper.css"), scripts=("wallet-api.js", "script.js"), body_class="record portfolio"),
    Page("/allocation/", "Allocation", "allocation", "Fund", "allocation",
         styles=("style.css", "allocation/style.css", "paper.css"),
         scripts=("wallet-api.js", "allocation/vendor/chart.umd.js", "allocation/vendor/datalabels.js", "allocation/view.js")),
    Page("/calendar/", "Calendar", "calendar", "Fund", "calendar",
         styles=("style.css", "calendar.css", "paper.css"), scripts=("calendar.js",)),
)
SHOWCASE = Page("/dev/components/", "Component showcase", "overview", "Operations", "showcase", styles=("style.css", "paper.css"), scripts=("workspace/showcase.js",))
